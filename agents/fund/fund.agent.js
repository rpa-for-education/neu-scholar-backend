// agents/fund/fund.agent.js

import { searchFund } from "./fund.search.js";
import { rankFunds } from "./fund.ranking.js";
import { getDb } from "../../db/mongo.js";
import { rewriteQuery, detectIntent } from "./fund.query.js";

const CACHE = new Map();
const TTL = 1000 * 60 * 5;

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

// 🔥 FIX QUAN TRỌNG: escape regex Mongo
function escapeRegex(text = "") {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTokens(query = "") {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2 && !/^\d+$/.test(w))
    .map(w => escapeRegex(w)); // 🔥 FIX
}

// ================= KEYWORD SEARCH =================
async function keywordSearch(query, limit = 10) {
  try {
    const db = await getDb();

    const tokens = extractTokens(query);

    if (!tokens.length) return [];

    const docs = await db.collection("fund").find({
      $or: tokens.map(t => ({
        "FUNDING DESCRIPTION": {
          $regex: t,
          $options: "i"
        }
      }))
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
      score: 0.5
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

    if (!map.has(key) || r.score > map.get(key).score) {
      map.set(key, r);
    }
  });

  return [...map.values()];
}

// ================= FILTER =================
function filterResults(results, intent) {
  const now = new Date();

  return results.filter(r => {
    const p = r.payload || {};

    // 👉 lọc deadline
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
    // 🔥 rewrite + intent
    const rewritten = await rewriteQuery(q, model_id);
    const intent = await detectIntent(q, model_id);

    // 🔥 hybrid search
    const [vectorResults, keywordResults] = await Promise.all([
      searchFund(rewritten, k * 3),
      keywordSearch(rewritten, k * 3)
    ]);

    const merged = mergeResults(vectorResults, keywordResults);

    if (!merged.length) return [];

    const filtered = filterResults(merged, intent);

    if (!filtered.length) return [];

    // 🔥 academic ranking
    const ranked = rankFunds(filtered, rewritten);

    const finalResults = ranked.slice(0, k);

    setCache(cacheKey, finalResults);

    return finalResults;

  } catch (err) {
    console.error("❌ Fund agent error:", err.message);
    return [];
  }
}