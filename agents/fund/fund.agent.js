import { searchFund } from "./fund.search.js";
import { rankFunds } from "./fund.ranking.js";
import { getDb } from "../../db/mongo.js";

// ================= CONFIG =================
const CACHE = new Map();
const TTL = 1000 * 60 * 3;
const CACHE_VERSION = "v5";

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

function safeScore(x) {
  return typeof x === "number" && !isNaN(x) ? x : 0;
}

// 🔥 FAST intent
function detectIntentFast(query = "") {
  const yearMatch = query.match(/20\d{2}/);

  return {
    year: yearMatch ? Number(yearMatch[0]) : null
  };
}

// 🔥 keyword trigger
function shouldUseKeyword(query) {
  const words = query.split(/\s+/);

  return (
    words.length >= 3 ||
    /(nsf|horizon|grant|fund|budget)/.test(query)
  );
}

// 🔥 adaptive retrieval size
function getSearchMultiplier(query) {
  const words = query.split(/\s+/);

  if (words.length <= 2) return 4;   // query ngắn → cần recall cao
  if (words.length <= 5) return 3;

  return 2; // query dài → đã rõ intent
}

// ================= KEYWORD SEARCH =================
async function keywordSearch(query, limit = 10) {
  try {
    const db = await getDb();

    const docs = await db.collection("fund")
      .find({ $text: { $search: query } })
      .project({
        "OPPORTUNITY TITLE": 1,
        "AGENCY NAME": 1,
        "FUNDING DESCRIPTION": 1,
        "ESTIMATED APPLICATION DUE DATE": 1,
        "ESTIMATED TOTAL FUNDING": 1,
        "OPPORTUNITY URL": 1,
        "URL": 1
      })
      .limit(limit)
      .toArray();

    return docs.map(d => ({
      id: d._id?.toString(),
      payload: {
        title: d["OPPORTUNITY TITLE"],
        agency: d["AGENCY NAME"],
        text: d["FUNDING DESCRIPTION"],
        deadline: d["ESTIMATED APPLICATION DUE DATE"],
        amount: d["ESTIMATED TOTAL FUNDING"],
        url: d["OPPORTUNITY URL"] || d["URL"]
      },
      score: 0.2
    }));

  } catch (err) {
    console.error("❌ Keyword search error:", err.message);
    return [];
  }
}

// ================= MERGE =================
function mergeResults(vector, keyword) {
  const map = new Map();

  vector.forEach(r => {
    const key = r.id || `${r.payload?.title}_${r.payload?.agency}`;
    if (!key) return;

    map.set(key, {
      ...r,
      score: safeScore(r.score)
    });
  });

  keyword.forEach(r => {
    const key = r.id || `${r.payload?.title}_${r.payload?.agency}`;
    if (!key) return;

    if (map.has(key)) {
      map.get(key).score += 0.1;
    }
  });

  return Array.from(map.values());
}

// ================= FILTER =================
function parseDateSafe(d) {
  if (!d) return null;

  const str = String(d);
  const date = str.includes("T")
    ? new Date(str)
    : new Date(str + "T00:00:00Z");

  return isNaN(date) ? null : date;
}

function filterResults(results, intent) {
  const now = Date.now();

  return results.filter(r => {
    const p = r.payload || {};
    const d = parseDateSafe(p.deadline);

    if (d) {
      if (d.getTime() < now) return false;

      if (intent.year && d.getUTCFullYear() !== intent.year) {
        return false;
      }
    }

    return true;
  });
}

// ================= MAIN =================
export async function runFundSearch(query, model_id, topk = 5) {
  const q = normalizeQuery(query);
  if (!q) return [];

  const k = safeTopk(topk);
  const intent = detectIntentFast(q);

  const useKeyword = shouldUseKeyword(q);

  const cacheKey = `${CACHE_VERSION}:${q}:${k}:${intent.year || "all"}:${useKeyword}`;

  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const multiplier = getSearchMultiplier(q);

    const vectorResults = await searchFund(q, k * multiplier).catch(() => []);

    // 🔥 nếu vector rất mạnh → skip keyword
    if (vectorResults.length >= k && safeScore(vectorResults[0]?.score) > 0.85) {
      const ranked = rankFunds(vectorResults, q).slice(0, k);
      setCache(cacheKey, ranked);
      return ranked;
    }

    let keywordResults = [];

    if (useKeyword) {
      keywordResults = await keywordSearch(q, k);
    }

    // 🔥 fallback nếu vector fail
    if (!vectorResults.length && keywordResults.length) {
      const fallback = keywordResults.slice(0, k);
      setCache(cacheKey, fallback);
      return fallback;
    }

    if (!vectorResults.length) return [];

    let merged = mergeResults(vectorResults, keywordResults);

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