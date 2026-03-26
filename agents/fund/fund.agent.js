import { searchFund } from "./fund.search.js";
import { rankFunds } from "./fund.ranking.js";
import { getDb } from "../../db/mongo.js";

// ================= CONFIG =================
const CACHE = new Map();
const TTL = 1000 * 60 * 3;

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

// ================= UTILS =================
function normalizeQuery(q) {
  return (q || "").trim().toLowerCase();
}

function safeTopk(k) {
  const n = Number(k);
  return n && n > 0 ? n : 5;
}

// 🔥 FAST intent (NO LLM)
function detectIntentFast(query = "") {
  const yearMatch = query.match(/20\d{2}/);

  return {
    year: yearMatch ? Number(yearMatch[0]) : null,
    domain: [],
    priority: "relevance"
  };
}

// ================= KEYWORD SEARCH (FAST) =================
async function keywordSearch(query, limit = 10) {
  try {
    const db = await getDb();

    const docs = await db.collection("fund")
      .find({
        $text: { $search: query }
      })
      .limit(limit)
      .toArray();

    return docs.map(d => ({
      payload: {
        title: d["OPPORTUNITY TITLE"],
        agency: d["AGENCY NAME"],
        text: d["FUNDING DESCRIPTION"],
        deadline: d["ESTIMATED APPLICATION DUE DATE"],
        amount: d["ESTIMATED TOTAL FUNDING"],
        url: d["OPPORTUNITY URL"] || d["URL"]
      },
      score: 0.4
    }));

  } catch (err) {
    console.error("❌ Keyword search error:", err.message);
    return [];
  }
}

// ================= MERGE =================
function mergeResults(vector, keyword) {
  const map = new Map();

  [...vector, ...keyword].forEach(r => {
    const key = r.payload?.title;
    if (!key) return;

    if (!map.has(key)) {
      map.set(key, r);
    } else {
      map.get(key).score += 0.2;
    }
  });

  return [...map.values()];
}

// ================= FILTER =================
function filterResults(results, intent) {
  const now = new Date();

  return results.filter(r => {
    const p = r.payload || {};

    if (p.deadline) {
      const d = new Date(p.deadline);

      if (!isNaN(d)) {
        if (d < now) return false;

        if (intent.year && d.getFullYear() !== intent.year) {
          return false;
        }
      }
    }

    return true;
  });
}

// ================= MAIN =================
export async function runFundSearch(query, model_id, topk = 5) {
  const q = normalizeQuery(query);
  const k = safeTopk(topk);

  const cacheKey = `${q}:${k}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const intent = detectIntentFast(q);

    // ⚡ chạy song song
    const vectorPromise = searchFund(q, k * 2).catch(() => []);
    const keywordPromise = keywordSearch(q, k * 2);

    const [vectorResults, keywordResults] = await Promise.all([
      vectorPromise,
      keywordPromise
    ]);

    // ⚡ early return nếu keyword đủ tốt
    if (keywordResults.length >= k) {
      setCache(cacheKey, keywordResults.slice(0, k));
      return keywordResults.slice(0, k);
    }

    let merged = mergeResults(vectorResults, keywordResults);

    if (!merged.length) return [];

    merged = filterResults(merged, intent);

    if (!merged.length) return [];

    const ranked = rankFunds(merged, q);

    const finalResults = ranked.slice(0, k);

    setCache(cacheKey, finalResults);

    return finalResults;

  } catch (err) {
    console.error("❌ Fund agent error:", err.message);
    return [];
  }
}