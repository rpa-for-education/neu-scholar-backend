// =========================================
// 🔥 HYBRID RANKING SYSTEM (PRODUCTION)
// BM25-lite + Semantic + Intent + Recency
// =========================================

// ================= CONFIG =================
const WEIGHTS = {
  vector: 0.4,     // Qdrant score
  keyword: 0.25,   // keyword matching
  intent: 0.2,     // intent boost
  recency: 0.1,    // deadline gần
  quality: 0.05    // Q1 / rank
};

// ================= UTILS =================
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
function keywordScore(item, query) {
  const qWords = tokenize(query);
  const text = normalize(
    item.name ||
    item.title ||
    ""
  );

  if (!text) return 0;

  let match = 0;

  for (const w of qWords) {
    if (text.includes(w)) match++;
  }

  return match / qWords.length;
}

// ================= INTENT BOOST =================
function intentScore(item, analysis) {
  let score = 0;

  // 🎯 NEU boost
  if (analysis.isNEU) {
    if ((item.organizer || "").toLowerCase().includes("kinh tế quốc dân")) {
      score += 1.0; // MAX boost
    }
  }

  // 🎯 country
  if (analysis.wantsCountryCode && item.country_code === analysis.wantsCountryCode) {
    score += 0.5;
  }

  // 🎯 field
  if (analysis.fieldHint) {
    const text = normalize(
      item.topics ||
      item.categories ||
      item.areas ||
      ""
    );

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
  // journal Q1
  if (item.sjr_best_quartile === "Q1") return 1;
  if (item.sjr_best_quartile === "Q2") return 0.7;

  // conference (có thể mở rộng sau)
  return 0.3;
}

// ================= FINAL SCORE =================
function computeScore(item, query, analysis) {
  const vector = item.score || 0;

  const keyword = keywordScore(item, query);
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

  return items
    .map(item => ({
      ...item,
      finalScore: computeScore(item, query, analysis)
    }))
    .sort((a, b) => b.finalScore - a.finalScore);
}

// ================= SMART FILTER =================
export function smartFilter(items) {
  if (!items || items.length === 0) return [];

  // 🔥 dynamic threshold
  const topScore = items[0]?.finalScore || 0;

  // giữ item >= 40% top
  const threshold = topScore * 0.4;

  const filtered = items.filter(it => it.finalScore >= threshold);

  // fallback nếu filter quá mạnh
  if (filtered.length === 0) return items.slice(0, 5);

  return filtered;
}