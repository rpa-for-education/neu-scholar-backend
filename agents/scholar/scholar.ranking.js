// =========================================
// 🔥 HYBRID RANKING SYSTEM (FINAL)
// BM25-lite + Semantic + Intent + Recency
// + SAFE LLM RERANK (NO DATA LOSS)
// =========================================

import { callLLM } from "../shared/llm.js";

// ================= CONFIG =================
const WEIGHTS = {
  vector: 0.4,
  keyword: 0.25,
  intent: 0.2,
  recency: 0.1,
  quality: 0.05
};

// ================= NORMALIZE =================
function normalize(text) {
  if (!text) return "";

  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ================= TOKENIZE =================
function tokenize(text) {
  return normalize(text).split(" ").filter(w => w.length > 2);
}

// ================= KEYWORD SCORE =================
function keywordScore(item, queryWords) {
  const text = normalize([
    item.name,
    item.title,
    item.topics,
    item.categories,
    item.areas,
    item.cfp_text,   // 🔥 quan trọng nhất
    item.city,
    item.country
  ].join(" "));

  if (!text || !queryWords.length) return 0;

  let match = 0;

  for (const w of queryWords) {
    if (text.includes(w)) match++;
  }

  return match / queryWords.length;
}

// ================= INTENT =================
function intentScore(item, analysis) {
  let score = 0;

  // 🎯 NEU boost
  if (analysis?.isNEU) {
    if ((item.organizer || "").toLowerCase().includes("kinh tế quốc dân")) {
      score += 1;
    }
  }

  // 🎯 country
  if (analysis?.wantsCountryCode && item.country_code === analysis.wantsCountryCode) {
    score += 0.5;
  }

  // 🎯 field
  if (analysis?.fieldHint) {
    const text = normalize([
      item.topics,
      item.categories,
      item.areas
    ].flat().join(" "));

    if (text.includes(normalize(analysis.fieldHint))) {
      score += 0.5;
    }
  }

  return Math.min(score, 1);
}

// ================= RECENCY =================
function recencyScore(item) {
  const dateStr = item.deadline || item.start_date;
  if (!dateStr) return 0;

  const now = new Date();
  const d = new Date(dateStr);

  const diff = (d - now) / (1000 * 60 * 60 * 24);

  if (diff < 0) return 0;
  if (diff < 30) return 1;
  if (diff < 90) return 0.7;
  if (diff < 180) return 0.4;

  return 0.1;
}

// ================= QUALITY =================
function qualityScore(item) {
  if (item.sjr_best_quartile === "Q1") return 1;
  if (item.sjr_best_quartile === "Q2") return 0.7;
  return 0.3;
}

// ================= FINAL SCORE =================
function computeScore(item, queryWords, analysis) {
  const vector = item.score ?? item._score ?? 0.3;

  const keyword = keywordScore(item, queryWords);
  const intent = intentScore(item, analysis);
  const recency = recencyScore(item);
  const quality = qualityScore(item);

  return (
    vector * WEIGHTS.vector +
    keyword * WEIGHTS.keyword +
    intent * WEIGHTS.intent +
    recency * WEIGHTS.recency +
    quality * WEIGHTS.quality
  );
}

// ================= MAIN RANK =================
export function rankItems(items, query, analysis = {}) {
  if (!items || items.length === 0) return [];

  const queryWords = tokenize(query);

  return items
    .map(item => ({
      ...item,
      finalScore: computeScore(item, queryWords, analysis)
    }))
    .sort((a, b) => b.finalScore - a.finalScore);
}

// ================= SMART FILTER =================
export function smartFilter(items) {
  if (!items || items.length === 0) return [];

  const topScore = items[0]?.finalScore || 0;

  // 🔥 tránh giữ quá nhiều item
  const threshold = Math.max(topScore * 0.4, 0.15);

  const filtered = items.filter(it => it.finalScore >= threshold);

  if (!filtered.length) return items.slice(0, 5);

  return filtered;
}

// =========================================
// 🔥 SAFE LLM RERANK (KHÔNG BAO GIỜ MẤT DATA)
// =========================================

function buildRerankPrompt(question, items) {
  let text = `Bạn là AI chọn lọc học thuật.

Chọn ra 5 mục phù hợp nhất với câu hỏi.

Chỉ trả về danh sách index (không giải thích).
Format: 0,2,4,...

Câu hỏi: ${question}

Danh sách:
`;

  items.forEach((it, i) => {
    const title = it.name || it.title;
    const extra = it.topics || it.categories || "";

    text += `[${i}] ${title} | ${extra}\n`;
  });

  return text;
}

function parseIndexes(output, max) {
  if (!output) return [];

  return output
    .split(/[, \n]/)
    .map(x => parseInt(x))
    .filter(x => !isNaN(x) && x >= 0 && x < max);
}

// ================= MAIN RERANK =================
export async function rerankWithLLM(items, question, topk = 5) {
  if (!items.length) return [];

  try {
    const slice = items.slice(0, 10);

    const prompt = buildRerankPrompt(question, slice);

    const res = await callLLM(prompt);
    const text = res?.answer || "";

    const indexes = parseIndexes(text, slice.length);

    // 🔥 fallback nếu LLM fail
    if (!indexes.length) {
      console.warn("⚠️ rerank empty → fallback");
      return slice.slice(0, topk);
    }

    return indexes.map(i => slice[i]).slice(0, topk);

  } catch (err) {
    console.warn("⚠️ rerank fail:", err.message);
    return items.slice(0, topk);
  }
}