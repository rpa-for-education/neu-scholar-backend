// fund.agent.js - FINAL STABLE (FIX EMPTY RESULT BUG - SAFE PATCH)

import { searchFund } from "./fund.search.js";
import { rankFunds } from "./fund.ranking.js";
import { rerankFunds } from "./fund.rerank.js";
import { detectIntent, rewriteQuery } from "./agentReasoning.js";

// ================= CONFIG =================
const CACHE = new Map();
const TTL = 1000 * 60 * 3;
const CACHE_VERSION = "v16"; // 🔥 bump version để clear cache cũ

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

// ================= 🔥 FIX: VN DETECTOR =================
function isVietnamRelated(text = "", agency = "") {
  const t = (text || "").toLowerCase();
  const a = (agency || "").toLowerCase();

  return (
    t.includes("vietnam") ||
    t.includes("việt") ||
    t.includes("nafosted") ||
    a.includes("vietnam") ||
    a.includes("việt") ||
    a.includes("nafosted")
  );
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

  if (
    (q.includes("việt") || q.includes("vietnam")) &&
    isVietnamRelated(t)
  ) {
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

    // ================= 🔥 BOOST NHẸ =================
    let adjusted = ranked.map(r => {
      const t = (r.payload?.text || "").toLowerCase();
      const a = (r.payload?.agency || "").toLowerCase();

      let bonus = 0;

      if (intent.country === "vietnam") {
        if (isVietnamRelated(t, a)) bonus += 0.15;
      }

      return { ...r, finalScore: r.finalScore + bonus };
    });

    adjusted = adjusted.sort((a, b) => b.finalScore - a.finalScore);

    let finalResults = adjusted.slice(0, k);

    // ================= 🔥 FIX QUAN TRỌNG =================
    if (intent.country === "vietnam") {
      const hasVN = finalResults.some(r =>
        isVietnamRelated(
          r.payload?.text,
          r.payload?.agency
        )
      );

      // ❌ KHÔNG return []
      // 👉 nếu không có VN thì giữ nguyên (fallback)
      if (!hasVN) {
        // optional: có thể log debug
        // console.warn("⚠️ No VN fund found, fallback to global results");
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