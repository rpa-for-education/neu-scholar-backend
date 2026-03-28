// fund.agent.js - FINAL FIX (NAFOSTED + SCHEMA MATCH)

import { searchFund } from "./fund.search.js";
import { rankFunds } from "./fund.ranking.js";
import { getDb } from "../../db/mongo.js";

// ================= CONFIG =================
const CACHE = new Map();
const TTL = 1000 * 60 * 3;
const CACHE_VERSION = "v12";

const DEBUG = true;

// ================= CACHE =================
function getCache(key) {
  const item = CACHE.get(key);
  if (!item) return null;

  if (Date.now() - item.time > TTL) {
    CACHE.delete(key);
    return null;
  }

  return item.value;
}

function setCache(key, value) {
  CACHE.set(key, { time: Date.now(), value });
}

// ================= 🔥 NORMALIZE FIX =================
function normalizeFundDoc(d) {
  return {
    // 🔥 FIX: đọc đúng schema Mongo của bạn
    title:
      d.title ||
      d.opportunity_title ||
      d["OPPORTUNITY TITLE"] ||
      "",

    agency:
      d.agency ||
      d.agency_name ||
      d["AGENCY NAME"] ||
      "",

    text:
      d.text ||
      d.description ||
      d["FUNDING DESCRIPTION"] ||
      "",

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

// ================= UTILS =================
function normalizeQuery(q) {
  return (q || "").trim().toLowerCase();
}

function expandQuery(q) {
  const map = {
    "quỹ": "fund grant funding",
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

function safeTopk(k) {
  return Number(k) || 5;
}

// ================= DEBUG =================
function logStep(step, data) {
  if (!DEBUG) return;

  console.log(`\n================ ${step} ================`);

  if (Array.isArray(data)) {
    console.log(`Count: ${data.length}`);

    data.slice(0, 5).forEach((r, i) => {
      console.log(
        `[${i + 1}]`,
        r.payload?.title,
        "| score:",
        (r.score ?? r.finalScore ?? 0).toFixed(3)
      );
    });
  } else {
    console.log(data);
  }
}

// ================= KEYWORD SEARCH =================
async function keywordSearch(query, limit = 10) {
  try {
    const db = await getDb();
    const words = query.split(/\s+/).filter(Boolean);

    const docs = await db.collection("fund")
      .find({
        $or: words.map(w => ({
          $or: [
            { opportunity_title: { $regex: w, $options: "i" } }, // 🔥 FIX
            { agency_name: { $regex: w, $options: "i" } },       // 🔥 FIX
            { text: { $regex: w, $options: "i" } }
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
        id: d._id?.toString(),
        payload: norm,
        score: 0.3 + hit * 0.2
      };
    });

    const result = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    logStep("KEYWORD", result);

    return result;

  } catch (err) {
    console.error("❌ keyword error:", err.message);
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
    const key = r.id || r.payload?.title;
    if (!key) return;

    if (map.has(key)) {
      map.get(key).score += 0.25;
    } else {
      map.set(key, r);
    }
  });

  const merged = Array.from(map.values());

  logStep("MERGED", merged);

  return merged;
}

// ================= FILTER FIX =================
function parseDateSafe(d) {
  if (!d) return null;
  const date = new Date(d);
  return isNaN(date) ? null : date;
}

function filterResults(results, query = "") {
  const now = Date.now();
  const q = query.toLowerCase();

  // 🔥 FIX: query info thì KHÔNG filter expired
  const isInfoQuery =
    q.includes("nafosted") ||
    q.includes("thông tin");

  const filtered = results.filter(r => {
    const d = parseDateSafe(r.payload?.deadline);

    if (!isInfoQuery) {
      if (d && d.getTime() < now) {
        if (DEBUG) console.log("❌ drop expired:", r.payload?.title);
        return false;
      }
    }

    return true;
  });

  logStep("FILTERED", filtered);

  return filtered;
}

// ================= MAIN =================
export async function runFundSearch(query, model_id, topk = 5) {
  const q = normalizeQuery(query);
  if (!q) return [];

  const expanded = expandQuery(q);
  const k = safeTopk(topk);

  logStep("QUERY", { q, expanded });

  const cacheKey = `${CACHE_VERSION}:${expanded}:${k}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const vectorResults = await searchFund(expanded, k * 3).catch(() => []);
    logStep("VECTOR", vectorResults);

    const keywordResults = await keywordSearch(q, k * 2);

    let merged = mergeResults(vectorResults, keywordResults);

    if (merged.length < k && keywordResults.length) {
      const extra = keywordResults.filter(
        kf => !merged.some(m => m.payload?.title === kf.payload?.title)
      );
      merged.push(...extra.slice(0, k));
    }

    // 🔥 FIX: truyền query vào filter
    merged = filterResults(merged, q);

    if (!merged.length) {
      return keywordResults.slice(0, k);
    }

    const ranked = rankFunds(merged, q);

    logStep("RANKED", ranked);

    const finalResults = ranked.slice(0, k);

    logStep("FINAL", finalResults);

    setCache(cacheKey, finalResults);

    return finalResults;

  } catch (err) {
    console.error("❌ Fund agent error:", err.message);
    return [];
  }
}