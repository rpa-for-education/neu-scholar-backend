// ================= SMART RANKING =================

// 👉 normalize text
function normalize(text) {
  return (text || "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");
}

// 👉 extract keywords từ câu hỏi
export function extractKeywords(question) {
  const stopwords = new Set([
    "the","is","are","a","an","of","in","on","for","and","to",
    "các","những","về","liên","quan","đến","cho","tôi","năm","bao","gồm"
  ]);

  return normalize(question)
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
}

// 👉 tính điểm semantic match (rất quan trọng)
function keywordScore(text, keywords) {
  const t = normalize(text);

  let score = 0;

  for (const k of keywords) {
    if (t.includes(k)) score += 1;
  }

  return score / (keywords.length || 1);
}

// 👉 deadline score (ưu tiên còn hạn)
function deadlineScore(deadline) {
  if (!deadline) return 0;

  const now = new Date();
  const d = new Date(deadline);

  if (isNaN(d)) return 0;

  const diffDays = (d - now) / (1000 * 60 * 60 * 24);

  if (diffDays < 0) return -1;       // quá hạn
  if (diffDays < 30) return 2;       // rất gần
  if (diffDays < 90) return 1;       // gần
  return 0.5;                        // xa
}

// 👉 main ranking function
export function rankItems(items, question) {
  const keywords = extractKeywords(question);

  return items.map(item => {
    const text = [
      item.name,
      item.title,
      item.topics,
      item.categories,
      item.areas
    ].join(" ");

    const semantic = keywordScore(text, keywords);
    const timeScore = deadlineScore(item.deadline);

    const vectorScore = item.score || 0;

    // 👉 weighted score
    const finalScore =
      vectorScore * 0.5 +
      semantic * 0.3 +
      timeScore * 0.2;

    return {
      ...item,
      finalScore,
      semantic,
      timeScore
    };
  })
  .sort((a, b) => b.finalScore - a.finalScore);
}

// 👉 filter thông minh
export function smartFilter(items) {
  return items.filter(item => {
    // bỏ những cái quá yếu
    if ((item.finalScore || 0) < 0.1) return false;

    // bỏ conference quá hạn
    if (item.deadline) {
      const d = new Date(item.deadline);
      if (d < new Date()) return false;
    }

    return true;
  });
}