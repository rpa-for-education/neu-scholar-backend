// fund.search.js - FINAL SYNC (AUTO NORMALIZE + STABLE SEARCH)

import { embed } from "../shared/embedding.js";
import { qdrantClient } from "../../db/qdrant.js";
import { getDb } from "../../db/mongo.js";

const COLLECTION =
  process.env.QDRANT_COLLECTION_FUND || "fund_vectors";

const CACHE_TTL = 1000 * 60 * 5;
const EMBED_TTL = 1000 * 60 * 30;
const TIMEOUT = 1500;

const CACHE_VERSION = "v10";

const CACHE = new Map();
const EMBED_CACHE = new Map();
const MAX_EMBED_CACHE = 200;

// ================= 🔥 NORMALIZE =================
function normalizeFundDoc(d) {
  return {
    title: d.title || d["OPPORTUNITY TITLE"] || "",
    agency: d.agency || d["AGENCY NAME"] || "",
    text: d.text || d["FUNDING DESCRIPTION"] || "",
    deadline: d.deadline || d["ESTIMATED APPLICATION DUE DATE"] || "",
    amount: d.amount || d["ESTIMATED TOTAL FUNDING"] || "",
    url: d.url || d["OPPORTUNITY URL"] || d["URL"] || ""
  };
}

// ================= CACHE =================
function getCache(map, key, ttl) {
  const item = map.get(key);
  if (!item) return null;

  if (Date.now() - item.time > ttl) {
    map.delete(key);
    return null;
  }

  map.delete(key);
  map.set(key, item);

  return item.value;
}

function setCache(map, key, value, maxSize = 500) {
  if (map.size >= maxSize) {
    const firstKey = map.keys().next().value;
    map.delete(firstKey);
  }

  map.set(key, { time: Date.now(), value });
}

// ================= UTILS =================
function normalizeQuery(query) {
  return (query || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function expandQuery(q) {
  const map = {
    "quỹ": "fund grant funding nafosted",
    "nghiên cứu": "research science project",
    "việt nam": "vietnam nafosted",
    "nafosted": "nafosted vietnam foundation science",
  };

  let expanded = q;

  for (const key in map) {
    if (expanded.includes(key)) {
      expanded += " " + map[key];
    }
  }

  return expanded;
}

function cleanQueryForEmbed(q) {
  return q.replace(/20\d{2}/g, "").trim();
}

function safeTopk(topk) {
  return Number(topk) || 5;
}

function extractYear(query) {
  const m = query.match(/20\d{2}/);
  return m ? Number(m[0]) : null;
}

function withTimeout(promise, ms = TIMEOUT) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

// ================= 🔥 KEYWORD SEARCH =================
async function keywordSearch(query, limit) {
  try {
    const db = await getDb();
    const words = query.split(/\s+/).filter(Boolean);

    const docs = await db.collection("fund")
      .find({
        $or: words.map(w => ({
          $or: [
            { title: { $regex: w, $options: "i" } },
            { agency: { $regex: w, $options: "i" } },
            { text: { $regex: w, $options: "i" } },
            { "OPPORTUNITY TITLE": { $regex: w, $options: "i" } },
            { "AGENCY NAME": { $regex: w, $options: "i" } },
            { "FUNDING DESCRIPTION": { $regex: w, $options: "i" } }
          ]
        }))
      })
      .limit(limit * 3)
      .toArray();

    const scored = docs.map(d => {
      const norm = normalizeFundDoc(d);

      const text = (
        norm.title +
        " " +
        norm.agency +
        " " +
        norm.text
      ).toLowerCase();

      let hit = 0;

      for (const w of words) {
        if (text.includes(w)) hit++;
      }

      return {
        payload: norm,
        score: 0.2 + hit * 0.15
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

  } catch {
    return [];
  }
}

// ================= MERGE =================
function mergeResults(vector, keyword) {
  const map = new Map();

  vector.forEach(r => {
    const norm = normalizeFundDoc(r.payload || r);
    const key = r.id || norm.title;
    if (!key) return;

    map.set(key, { ...r, payload: norm });
  });

  keyword.forEach(r => {
    const key = r.payload?.title;
    if (!key) return;

    if (map.has(key)) {
      map.get(key).score += 0.2;
    } else {
      map.set(key, r);
    }
  });

  return Array.from(map.values());
}

// ================= MAIN =================
export async function searchFund(query, topk = 5) {
  try {
    const normalized = normalizeQuery(query);
    if (!normalized) return [];

    const expandedQuery = expandQuery(normalized);

    const limit = safeTopk(topk);
    const year = extractYear(normalized);

    const cacheKey = `${CACHE_VERSION}:${expandedQuery}:${limit}:${year || "all"}`;

    const cached = getCache(CACHE, cacheKey, CACHE_TTL);
    if (cached) return cached;

    const embedQuery = cleanQueryForEmbed(expandedQuery);

    let vector = getCache(EMBED_CACHE, embedQuery, EMBED_TTL);

    if (!vector) {
      vector = await withTimeout(embed(embedQuery), 1200).catch(() => null);

      if (vector) {
        setCache(EMBED_CACHE, embedQuery, vector, MAX_EMBED_CACHE);
      }
    }

    let vectorResults = [];

    if (vector) {
      vectorResults = await withTimeout(
        qdrantClient.search(COLLECTION, {
          vector,
          limit: limit * 3,
          with_payload: true,
          score_threshold: 0.05,
        }),
        TIMEOUT
      ).catch(() => []);
    }

    const keywordResults = await keywordSearch(normalized, limit * 2);

    let merged = mergeResults(vectorResults, keywordResults);

    if (merged.length < limit && keywordResults.length) {
      const extra = keywordResults.filter(
        k => !merged.some(m => m.payload?.title === k.payload?.title)
      );
      merged.push(...extra.slice(0, limit));
    }

    if (!merged.length) return [];

    if (year) {
      const filtered = merged.filter(r => {
        const d = new Date(r.payload?.deadline);
        return !isNaN(d) && d.getUTCFullYear() === year;
      });

      if (filtered.length) merged = filtered;
    }

    const finalResult = merged.slice(0, limit);

    setCache(CACHE, cacheKey, finalResult);

    return finalResult;

  } catch (err) {
    console.error("❌ searchFund error:", err.message);
    return [];
  }
}