// fund.agent.js - FINAL BEST + INTENT LAYER

import { searchFund } from "./fund.search.js";
import { rankFunds } from "./fund.ranking.js";
import { getDb } from "../../db/mongo.js";
import { rerankFunds } from "./fund.rerank.js";
import { detectIntent, rewriteQuery } from "./agentReasoning.js";

// ================= CONFIG =================
const CACHE = new Map();
const TTL = 1000 * 60 * 3;
const CACHE_VERSION = "v13";

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
    if (!map.has(key)) map.set(key, r);
  });

  return Array.from(map.values());
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
    let vectorResults = await searchFund(expanded, k * 3).catch(() => []);

    vectorResults = vectorResults.map(r => ({
      ...r,
      score: Math.max(0, Math.min(1, r.score || 0))
    }));

    let merged = mergeResults(vectorResults, []);
    if (!merged.length) return [];

    let ranked = rankFunds(merged, q);

    // ================= 🔥 INTENT-AWARE BOOST =================
    let filtered = ranked.map(r => {
      const t = (r.payload?.text || "").toLowerCase();
      const a = (r.payload?.agency || "").toLowerCase();

      let bonus = 0;

      // COUNTRY
      if (intent.country === "vietnam") {
        if (t.includes("vietnam") || t.includes("nafosted")) bonus += 0.25;
        if (a.includes("vietnam")) bonus += 0.25;

        if (
          a.includes("nsf") ||
          a.includes("u.s.") ||
          a.includes("naval")
        ) {
          bonus -= 0.2;
        }
      }

      // YEAR
      if (intent.year) {
        const d = new Date(r.payload?.deadline || "");
        if (!isNaN(d)) {
          if (d.getFullYear() >= intent.year - 1) bonus += 0.1;
          else bonus -= 0.1;
        }
      }

      return { ...r, finalScore: r.finalScore + bonus };
    });

    filtered = filtered.sort((a, b) => b.finalScore - a.finalScore);

    // ================= FALLBACK =================
    let finalResults = filtered.slice(0, k);

    if (
      intent.country === "vietnam" &&
      finalResults.every(r => {
        const t = (r.payload?.text || "").toLowerCase();
        return !t.includes("vietnam") && !t.includes("nafosted");
      })
    ) {
      const fallback = ranked.filter(r => {
        const t = (r.payload?.text || "").toLowerCase();
        return t.includes("vietnam") || t.includes("nafosted");
      });

      if (fallback.length > 0) {
        finalResults = fallback.slice(0, k);
      }
    }

    // ================= RERANK =================
    try {
      const reranked = await rerankFunds(q, finalResults, model_id);
      if (reranked?.length) {
        const remain = finalResults.filter(f => !reranked.includes(f));
        finalResults = [...reranked, ...remain].slice(0, k);
      }
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