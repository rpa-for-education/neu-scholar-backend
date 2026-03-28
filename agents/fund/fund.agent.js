// fund.agent.js - FINAL UPGRADE (GEO + TIME + SMART BOOST)

import { searchFund } from "./fund.search.js";
import { rankFunds } from "./fund.ranking.js";
import { getDb } from "../../db/mongo.js";
import { rerankFunds } from "./fund.rerank.js";

// ================= CONFIG =================
const CACHE = new Map();
const TTL = 1000 * 60 * 3;
const CACHE_VERSION = "v11"; // 🔥 bump version

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

function expandQuery(q) {
  let expanded = q;

  if (q.includes("quỹ")) expanded += " fund grant funding";
  if (q.includes("nghiên cứu")) expanded += " research science";
  if (q.includes("nafosted")) expanded += " nafosted vietnam foundation";
  if (q.includes("việt")) expanded += " vietnam";

  return expanded;
}

function safeTopk(k) {
  const n = Number(k);
  return n && n > 0 ? n : 5;
}

// ================= EXPLAIN =================
function explainFund(item, query) {
  const q = query.toLowerCase();
  const t = (item.payload?.text || "").toLowerCase();

  const reasons = [];

  if (item.explain?.semantic > 0.6) {
    reasons.push("liên quan nội dung tốt");
  }

  if (item.explain?.funding > 0.6) {
    reasons.push("mức tài trợ cao");
  }

  if (item.explain?.deadline > 0.7) {
    reasons.push("deadline gần");
  }

  if (
    q.includes("nafosted") &&
    (t.includes("nafosted") || t.includes("khoa học và công nghệ quốc gia"))
  ) {
    reasons.push("đúng quỹ Nafosted");
  }

  if (
    (q.includes("việt") || q.includes("vietnam")) &&
    t.includes("vietnam")
  ) {
    reasons.push("liên quan Việt Nam");
  }

  if (!reasons.length) {
    reasons.push("phù hợp tương đối với yêu cầu");
  }

  return reasons.join(", ");
}

// ================= MERGE =================
function mergeResults(vector, keyword) {
  const map = new Map();

  vector.forEach(r => {
    const key = r.id || r.payload?.title;
    if (!key) return;
    map.set(key, r);
  });

  keyword.forEach(r => {
    const key = r.payload?.title;
    if (!key) return;

    if (!map.has(key)) {
      map.set(key, r);
    }
  });

  return Array.from(map.values());
}

// ================= MAIN =================
export async function runFundSearch(query, model_id, topk = 5) {
  const q = normalizeQuery(query);
  if (!q) return [];

  const expanded = expandQuery(q);
  const k = safeTopk(topk);

  const cacheKey = `${CACHE_VERSION}:${expanded}:${k}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    // ================= SEARCH =================
    let vectorResults = await searchFund(expanded, k * 3).catch(() => []);

    vectorResults = vectorResults.map(r => ({
      ...r,
      score: Math.max(0, Math.min(1, r.score || 0))
    }));

    let merged = mergeResults(vectorResults, []);

    if (!merged.length) return [];

    let ranked = rankFunds(merged, q);

    // ================= 🔥 FILTER (GEO + TIME) =================
    let filtered = ranked;

    // 🔥 GEO FILTER
    if (q.includes("việt") || q.includes("vietnam")) {
      const vn = ranked.filter(r => {
        const t = (r.payload?.text || "").toLowerCase();
        const a = (r.payload?.agency || "").toLowerCase();

        return (
          t.includes("vietnam") ||
          t.includes("việt") ||
          t.includes("nafosted") ||
          a.includes("vietnam")
        );
      });

      if (vn.length >= 2) filtered = vn;
    }

    // 🔥 TIME FILTER
    const now = Date.now();

    filtered = filtered.filter(r => {
      const d = new Date(r.payload?.deadline || "");
      if (isNaN(d)) return true;

      const diffDays = (d.getTime() - now) / (1000 * 60 * 60 * 24);

      return diffDays > -365; // không quá cũ
    });

    // 🔥 YEAR FILTER (2026 intent)
    if (q.includes("2026")) {
      filtered = filtered.filter(r => {
        const d = new Date(r.payload?.deadline || "");
        if (isNaN(d)) return false;
        return d.getFullYear() >= 2025;
      });
    }

    // ================= BOOST =================
    filtered = filtered.sort((a, b) => {
      const ta = (a.payload?.text || "").toLowerCase();
      const tb = (b.payload?.text || "").toLowerCase();
      const ql = q.toLowerCase();

      const boost = (t) => {
        let s = 0;

        // Nafosted
        if (ql.includes("nafosted")) {
          if (
            t.includes("nafosted") ||
            t.includes("khoa học và công nghệ quốc gia")
          ) s += 3;
        }

        // Vietnam
        if (ql.includes("việt") || ql.includes("vietnam")) {
          if (t.includes("vietnam") || t.includes("nafosted")) s += 2;
          else s -= 2; // 🔥 phạt US fund
        }

        return s;
      };

      return (b.finalScore + boost(tb)) - (a.finalScore + boost(ta));
    });

    // ================= RERANK =================
    let finalResults = filtered.slice(0, k);

    try {
      const reranked = await rerankFunds(q, finalResults, model_id);

      if (reranked?.length) {
        const remain = finalResults.filter(f => !reranked.includes(f));
        finalResults = [...reranked, ...remain].slice(0, k);
      }
    } catch (err) {
      console.warn("⚠️ rerank skip:", err.message);
    }

    // ================= FILL =================
    if (finalResults.length < k) {
      const remain = ranked.filter(r => !finalResults.includes(r));
      finalResults = [...finalResults, ...remain.slice(0, k - finalResults.length)];
    }

    // ================= EXPLAIN =================
    finalResults = finalResults.map(r => ({
      ...r,
      explainText: explainFund(r, q)
    }));

    setCache(cacheKey, finalResults);

    return finalResults;

  } catch (err) {
    console.error("❌ fund agent error:", err.message);
    return [];
  }
}