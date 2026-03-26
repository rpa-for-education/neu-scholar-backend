// =========================================
// 🔥 HYBRID RANKING SYSTEM (NO LLM - FINAL)
// BM25-lite + Semantic + Intent + Recency
// =========================================

// ================= CONFIG =================
const WEIGHTS = {
  vector: 0.5,   // 🔥 tăng vì bỏ LLM
  keyword: 0.25,
  intent: 0.15,
  recency: 0.07,
  quality: 0.03
};

// ================= NORMALIZE (FAST) =================
function normalize(text) {
  if (!text) return "";

  return text
    .toLowerCase()
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
    item.cfp_text,
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

  // 🎯 FIX NEU (quan trọng)
  if (analysis?.location?.name === "NEU") {
    if ((item.organizer || "").toLowerCase().includes("kinh tế quốc dân")) {
      score += 1;
    }
  }

  if (analysis?.wantsCountryCode && item.country_code === analysis.wantsCountryCode) {
    score += 0.5;
  }

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

  const now = Date.now();
  const d = new Date(dateStr).getTime();

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

  const threshold = Math.max(topScore * 0.4, 0.15);

  const filtered = items.filter(it => it.finalScore >= threshold);

  if (!filtered.length) return items.slice(0, 5);

  return filtered;
}