// agents/fund/fund.ranking.js

// ================= REGEX =================
const RE_BILLION = /\b(billion|bn)\b/;
const RE_MILLION = /\b(million|mn)\b|\d+(\.\d+)?m\b/;
const RE_THOUSAND = /\b(thousand)\b|\d+(\.\d+)?k\b/;

// ================= PARSE AMOUNT =================
function parseAmount(amount) {
  if (!amount) return 0;

  const str = String(amount).toLowerCase().replace(/,/g, "").trim();

  // 🔥 tránh false positive "month"
  if (/(month|day|year)/.test(str)) return 0;

  const isBillion = RE_BILLION.test(str);
  const isMillion = RE_MILLION.test(str);
  const isThousand = RE_THOUSAND.test(str);

  const num = parseFloat(str.replace(/[^0-9.]/g, ""));
  if (!num) return 0;

  if (isBillion) return num * 1e9;
  if (isMillion) return num * 1e6;
  if (isThousand) return num * 1e3;

  return num;
}

// ================= DEADLINE =================
function parseDeadline(deadline) {
  if (!deadline) return null;

  const str = String(deadline);

  const d = str.includes("T")
    ? new Date(str)
    : new Date(str + "T00:00:00Z");

  return isNaN(d) ? null : d;
}

// ================= SCORING =================
function fundingScore(amount, amount_num) {
  const val = amount_num || parseAmount(amount);

  if (val >= 1e9) return 1;
  if (val >= 1e8) return 0.9;
  if (val >= 1e7) return 0.7;
  if (val >= 1e6) return 0.5;

  return 0.3;
}

// 🔥 smooth + clamp
function deadlineScore(deadline) {
  const d = parseDeadline(deadline);
  if (!d) return 0.3;

  const now = Date.now();
  const diffDays = (d.getTime() - now) / (1000 * 60 * 60 * 24);

  if (diffDays < 0) return 0;

  let score;

  if (diffDays <= 7) score = 1;
  else if (diffDays <= 30) score = 0.85 - (diffDays - 7) * 0.01;
  else if (diffDays <= 90) score = 0.65 - (diffDays - 30) * 0.003;
  else score = 0.4;

  // 🔥 clamp
  return Math.max(0, Math.min(1, score));
}

// ================= TEXT SCORE =================
function textScore(text, query) {
  if (!text) return 0;

  const t = text.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 4);

  if (!words.length) return 0;

  let hit = 0;

  for (const w of words) {
    if (t.includes(w)) hit++;
  }

  const ratio = hit / words.length;

  // 🔥 tránh overfit query ngắn
  return Math.sqrt(Math.min(ratio, 0.9));
}

// ================= WEIGHTS =================
function getWeights(query) {
  const q = query.toLowerCase();

  let w = {
    semantic: 0.5,
    funding: 0.2,
    deadline: 0.2,
    text: 0.1
  };

  if (/(fund|budget|grant|money)/.test(q)) {
    w.funding += 0.1;
    w.semantic -= 0.05;
  }

  if (/(deadline|soon|urgent|closing)/.test(q)) {
    w.deadline += 0.1;
    w.semantic -= 0.05;
  }

  if (/(ai|research|automation|ml|data)/.test(q)) {
    w.semantic += 0.05;
  }

  const sum = Object.values(w).reduce((a, b) => a + b, 0);

  for (const k in w) {
    w[k] = w[k] / sum;
  }

  return w;
}

// ================= SAFE =================
function safe(x, fallback = 0) {
  return typeof x === "number" && !isNaN(x) ? x : fallback;
}

// ================= MAIN =================
export function rankFunds(results, query) {
  const weights = getWeights(query);

  return results
    .map((r, idx) => {
      const p = r.payload || {};

      const amount_num = p.amount_num || parseAmount(p.amount);

      const fScore = safe(fundingScore(p.amount, amount_num), 0.3);
      const dScore = safe(deadlineScore(p.deadline), 0.3);
      const tScore = safe(textScore(p.text, query), 0);
      const vScore = Math.max(0, Math.min(1, safe(r.score, 0)));

      let finalScore =
        weights.semantic * vScore +
        weights.funding * fScore +
        weights.deadline * dScore +
        weights.text * tScore;

      finalScore = Math.max(0, Math.min(1, finalScore));

      return {
        ...r,
        finalScore,
        amount_num,
        explain: {
          semantic: vScore,
          funding: fScore,
          deadline: dScore,
          text: tScore
        },
        _idx: idx
      };
    })
    .sort((a, b) => {
      if (b.finalScore !== a.finalScore) {
        return b.finalScore - a.finalScore;
      }

      if ((b.amount_num || 0) !== (a.amount_num || 0)) {
        return (b.amount_num || 0) - (a.amount_num || 0);
      }

      return a._idx - b._idx;
    });
}