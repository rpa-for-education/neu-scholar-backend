// fund.search.js - FINAL FIX (NAFOSTED MATCH + CLEAN RESULT)

import { embed } from "../shared/embedding.js";
import { qdrantClient } from "../../db/qdrant.js";
import { getDb } from "../../db/mongo.js";

const COLLECTION =
  process.env.QDRANT_COLLECTION_FUND || "fund_vectors";

const CACHE_TTL = 1000 * 60 * 5;
const EMBED_TTL = 1000 * 60 * 30;
const TIMEOUT = 1500;

const CACHE_VERSION = "v11";

const CACHE = new Map();
const EMBED_CACHE = new Map();
const MAX_EMBED_CACHE = 200;

// ================= 🔥 NORMALIZE (FIX QUAN TRỌNG) =================
function normalizeFundDoc(d) {
  const title =
    d.title ||
    d.opportunity_title ||
    d["OPPORTUNITY TITLE"] ||
    "";

  const agency =
    d.agency ||
    d.agency_name ||
    d["AGENCY NAME"] ||
    "";

  const baseText =
    d.text ||
    d.description ||
    d["FUNDING DESCRIPTION"] ||
    "";

  // 🔥 FIX: inject agency vào text (QUAN TRỌNG NHẤT)
  const text = `${title} ${agency} ${baseText}`.toLowerCase();

  return {
    title,
    agency,
    text,

    deadline:
      d.deadline ||
      d.close_date ||
      d["ESTIMATED APPLICATION DUE DATE"] ||
      "",

    amount:
      d.amount ||
      d.funding_amount ||
      d["ESTIMATED TOTAL FUNDING"] ||
      "",

    url:
      d.url ||
      d.additional_info_url ||
      d["OPPORTUNITY URL"] ||
      d["URL"] ||
      ""
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

// 🔥 FIX: expand mạnh hơn cho VN
function expandQuery(q) {
  let expanded = q;

  if (q.includes("quỹ")) expanded += " fund grant funding";
  if (q.includes("nghiên cứu")) expanded += " research science";
  if (q.includes("nafosted")) expanded += " nafosted vietnam science foundation";
  if (q.includes("việt")) expanded += " vietnam nafosted";

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

// ================= 🔥 KEYWORD SEARCH (BOOST CHUẨN) =================
async function keywordSearch(query, limit) {
  try {
    const db = await getDb();
    const words = query.split(/\s+/).filter(w => w.length > 2);

    const docs = await db.collection("fund")
      .find({
        $or: words.map(w => ({
          $or: [
            { opportunity_title: { $regex: w, $options: "i" } },
            { agency_name: { $regex: w, $options: "i" } },
            { text: { $regex: w, $options: "i" } }
          ]
        }))
      })
      .limit(limit * 3)
      .toArray();

    const scored = docs.map(d => {
      const norm = normalizeFundDoc(d);

      const full = norm.text;

      let hit = 0;

      for (const w of words) {
        if (full.includes(w)) hit++;
      }

      let score = 0.2 + hit * 0.2;

      // 🔥 BOOST NAFOSTED
      if (
        query.includes("nafosted") &&
        full.includes("nafosted")
      ) {
        score += 1.5;
      }

      return {
        payload: norm,
        score
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
      map.get(key).score += 0.3;
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