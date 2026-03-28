// fund.agent.js - FINAL STABLE (KEEP BEHAVIOR + FIX YEAR BUG)

import { searchFund } from "./fund.search.js";
import { rankFunds } from "./fund.ranking.js";
import { rerankFunds } from "./fund.rerank.js";
import { detectIntent, rewriteQuery } from "./agentReasoning.js";

// ================= CONFIG =================
const CACHE = new Map();
const TTL = 1000 * 60 * 3;
const CACHE_VERSION = "v15";

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

// ================= EXPLAIN =================
function explainFund(item, query) {
  const q = query.toLowerCase();
  const t = (item.payload?.text || "").toLowerCase();

  const reasons = [];

  if (item.explain?.semantic > 0.6) reasons.push("liên quan nội dung tốt");
  if (item.explain?.funding > 0.6) reasons.push("mức tài trợ cao");
  if (item.explain?.deadline > 0.7) reasons.push("deadline gần");

  if (
    q.includes("nafosted") &&
    (t.includes("nafosted") || t.includes("khoa học và công nghệ quốc gia"))
  ) {
    reasons.push("đúng quỹ Nafosted");
  }

  if ((q.includes("việt") || q.includes("vietnam")) && t.includes("vietnam")) {
    reasons.push("liên quan Việt Nam");
  }

  if (!reasons.length) reasons.push("phù hợp tương đối với yêu cầu");

  return reasons.join(", ");
}

// ================= MAIN =================
export async function runFundSearch(query, model_id, topk = 5) {
  const q = normalizeQuery(query);
  if (!q) return [];

  const intent = detectIntent(q);
  const expanded = rewriteQuery(q, intent);
  const k = safeTopk(topk);

  const cacheKey = `${CACHE_VERSION}:${expanded}:${k}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    let results = await searchFund(expanded, k * 3).catch(() => []);
    if (!results.length) return [];

    results = results.map(r => ({
      ...r,
      score: Math.max(0, Math.min(1, r.score || 0))
    }));

    let ranked = rankFunds(results, q);

    // ================= 🔥 BOOST NHẸ (KHÔNG PHÁ SEMANTIC) =================
    let adjusted = ranked.map(r => {
      const t = (r.payload?.text || "").toLowerCase();
      const a = (r.payload?.agency || "").toLowerCase();

      let bonus = 0;

      // COUNTRY (nhẹ thôi)
      if (intent.country === "vietnam") {
        if (t.includes("vietnam") || t.includes("nafosted")) bonus += 0.15;
        if (a.includes("vietnam")) bonus += 0.15;
      }

      return { ...r, finalScore: r.finalScore + bonus };
    });

    adjusted = adjusted.sort((a, b) => b.finalScore - a.finalScore);

    let finalResults = adjusted.slice(0, k);

    // ================= 🔥 VALIDATION NHẸ =================
    if (intent.country === "vietnam") {
      const hasVN = finalResults.some(r => {
        const t = (r.payload?.text || "").toLowerCase();
        return t.includes("vietnam") || t.includes("nafosted");
      });

      // ❗ nếu không có VN → không trả US nữa
      if (!hasVN) {
        return [];
      }
    }

    // ================= RERANK =================
    try {
      const reranked = await rerankFunds(q, finalResults, model_id);
      if (reranked?.length) finalResults = reranked;
    } catch {}

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