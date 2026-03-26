import { searchFund } from "./fund.search.js";
import { rankFunds } from "./fund.ranking.js";
import { getDb } from "../../db/mongo.js";

// ================= CONFIG =================
const CACHE = new Map();
const TTL = 1000 * 60 * 3;
const CACHE_VERSION = "v6";

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

// 🔥 MULTILINGUAL FIX (QUAN TRỌNG)
function expandQuery(q) {
  const map = {
    "quỹ": "fund grant funding",
    "nghiên cứu": "research science project",
    "việt nam": "vietnam vietnamese",
    "tài trợ": "grant funding",
    "học bổng": "scholarship fellowship"
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
  const n = Number(k);
  return n && n > 0 ? n : 5;
}

function safeScore(x) {
  return typeof x === "number" && !isNaN(x) ? x : 0;
}

// ================= INTENT =================
function detectIntentFast(query = "") {
  const yearMatch = query.match(/20\d{2}/);

  return {
    year: yearMatch ? Number(yearMatch[0]) : null
  };
}

function shouldUseKeyword(query) {
  return (
    query.split(/\s+/).length >= 2 // 🔥 giảm threshold
  );
}

// ================= KEYWORD SEARCH (FIX DATA VN) =================
async function keywordSearch(query, limit = 10) {
  try {
    const db = await getDb();

    // 🔥 fallback regex cho tiếng Việt
    const docs = await db.collection("fund")
      .find({
        $or: [
          { title: { $regex: query, $options: "i" } },
          { agency: { $regex: query, $options: "i" } },
          { text: { $regex: query, $options: "i" } }
        ]
      })
      .limit(limit)
      .toArray();

    return docs.map(d => ({
      id: d._id?.toString(),
      payload: {
        title: d.title || d["OPPORTUNITY TITLE"],
        agency: d.agency || d["AGENCY NAME"],
        text: d.text || d["FUNDING DESCRIPTION"],
        deadline: d.deadline || d["ESTIMATED APPLICATION DUE DATE"],
        amount: d.amount || d["ESTIMATED TOTAL FUNDING"],
        url: d.url || d["OPPORTUNITY URL"] || d["URL"]
      },
      score: 0.3 // 🔥 tăng weight keyword
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
      map.get(key).score += 0.15; // 🔥 boost mạnh hơn
    } else {
      map.set(key, r); // 🔥 thêm mới luôn
    }
  });

  return Array.from(map.values());
}

// ================= FILTER =================
function parseDateSafe(d) {
  if (!d) return null;

  const date = new Date(d);
  return isNaN(date) ? null : date;
}

function filterResults(results, intent) {
  const now = Date.now();

  return results.filter(r => {
    const d = parseDateSafe(r.payload?.deadline);

    if (d && d.getTime() < now) return false;

    if (intent.year && d && d.getFullYear() !== intent.year) {
      return false;
    }

    return true;
  });
}

// ================= MAIN =================
export async function runFundSearch(query, model_id, topk = 5) {
  const q = normalizeQuery(query);
  if (!q) return [];

  const expanded = expandQuery(q); // 🔥 FIX KEY

  const k = safeTopk(topk);
  const intent = detectIntentFast(q);

  const cacheKey = `${CACHE_VERSION}:${expanded}:${k}`;

  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    // 🔥 vector dùng expanded query
    const vectorResults = await searchFund(expanded, k * 3).catch(() => []);

    let keywordResults = [];

    if (shouldUseKeyword(q)) {
      keywordResults = await keywordSearch(q, k);
    }

    // 🔥 fallback mạnh
    if (!vectorResults.length && keywordResults.length) {
      return keywordResults.slice(0, k);
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