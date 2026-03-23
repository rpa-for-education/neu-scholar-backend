// agents/fund/fund.ranking.js

// ================= PARSE UTILS =================
function parseAmount(amount) {
  if (!amount) return 0;

  const str = String(amount).toLowerCase();

  const num = parseFloat(str.replace(/[^0-9.]/g, ""));
  if (!num) return 0;

  if (str.includes("million") || str.includes("m")) return num * 1e6;
  if (str.includes("billion") || str.includes("b")) return num * 1e9;

  return num;
}

function parseDeadline(deadline) {
  if (!deadline) return null;

  const d = new Date(deadline);
  return isNaN(d) ? null : d;
}

// ================= SCORING =================
function fundingScore(amount) {
  const val = parseAmount(amount);

  if (val >= 1e9) return 1;
  if (val >= 1e8) return 0.9;
  if (val >= 1e7) return 0.7;
  if (val >= 1e6) return 0.5;

  return 0.3;
}

function deadlineScore(deadline) {
  const d = parseDeadline(deadline);
  if (!d) return 0.3;

  const now = new Date();
  const diffDays = (d - now) / (1000 * 60 * 60 * 24);

  if (diffDays < 0) return 0;
  if (diffDays <= 7) return 1;
  if (diffDays <= 30) return 0.8;
  if (diffDays <= 90) return 0.6;

  return 0.4;
}

function textScore(text, query) {
  if (!text) return 0;

  const t = text.toLowerCase();
  const q = query.toLowerCase().split(/\s+/);

  let score = 0;

  q.forEach(word => {
    if (word.length > 3 && t.includes(word)) {
      score += 1;
    }
  });

  return Math.min(score / 5, 1);
}

// ================= MAIN =================
export function rankFunds(results, query) {
  return results
    .map(r => {
      const p = r.payload || {};

      const fScore = fundingScore(p.amount);
      const dScore = deadlineScore(p.deadline);
      const tScore = textScore(p.text, query);
      const vScore = r.score || 0;

      // 🔥 TRỌNG SỐ CHUẨN ACADEMIC
      const finalScore =
        0.35 * tScore +   // relevance
        0.30 * fScore +   // funding
        0.25 * dScore +   // deadline
        0.10 * vScore;    // vector

      return {
        ...r,
        finalScore
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore);
}