// fund.service.js - FINAL HUMAN + SMART BEST (PATCH DOMAIN FIX - NO REMOVE + HARD FILTER VN)

import { runFundSearch } from "./fund.agent.js";
import { addToHistory } from "../../middlewares/session.js";

const MAX_RETURN = 5;

// ================= PARSE AMOUNT =================
function parseAmount(v) {
  if (!v) return 0;
  if (typeof v === "number") return v;

  const str = String(v).toLowerCase().replace(/,/g, "").trim();

  const isBillion = /\b(billion|bn)\b/.test(str);
  const isMillion = /\b(million|mn)\b|\d+(\.\d+)?m\b/.test(str);
  const isThousand = /\b(thousand)\b|\d+(\.\d+)?k\b/.test(str);

  const num = parseFloat(str.replace(/[^0-9.]/g, ""));
  if (!num) return 0;

  if (isBillion) return num * 1e9;
  if (isMillion) return num * 1e6;
  if (isThousand) return num * 1e3;

  return num;
}

// ================= NORMALIZE =================
function normalizeFunds(arr) {
  return arr.map((r, idx) => {
    const p = r.payload || r;

    const amount_num = p.amount_num || parseAmount(p.amount);

    return {
      title: p.title || "",
      agency: p.agency || "",
      deadline: p.deadline || "",
      amount: p.amount || "",
      amount_num,
      url: p.url || "",
      text: p.text || "",
      score: Math.max(0, Math.min(1, Number(r.finalScore ?? r.score ?? 0))),
      _idx: idx
    };
  });
}

// ================= 🔥 INTENT MATCH =================
function relevanceScore(fund, query) {
  const t = (fund.title + " " + fund.text + " " + fund.agency).toLowerCase();
  const q = query.toLowerCase();

  let score = 0;

  // Nafosted core
  if (
    (q.includes("cơ bản") || q.includes("basic")) &&
    (q.includes("việt") || q.includes("vietnam"))
  ) {
    if (
      t.includes("nafosted") ||
      t.includes("khoa học và công nghệ quốc gia") ||
      t.includes("quỹ phát triển khoa học")
    ) {
      score += 10;
    }
  }

  // Nafosted boost
  if (q.includes("nafosted")) {
    if (
      t.includes("nafosted") ||
      t.includes("khoa học và công nghệ quốc gia") ||
      t.includes("quỹ phát triển khoa học")
    ) {
      score += 5;
    }
  }

  // Vietnam boost
  if (q.includes("việt") || q.includes("vietnam")) {
    if (t.includes("vietnam") || t.includes("việt")) score += 1;
  }

  // Collaboration penalty
  if (q.includes("cơ bản") || q.includes("basic")) {
    if (
      t.includes("hợp tác") ||
      t.includes("collaboration") ||
      t.includes("bilateral") ||
      t.includes("joint research")
    ) {
      score -= 3;
    }
  }

  // 🔥 OLD FUND PENALTY
  try {
    const d = new Date(fund.deadline);
    if (!isNaN(d)) {
      if (d.getFullYear() < 2022) score -= 2;
      if (d > new Date()) score += 1;
    }
  } catch {}

  return score;
}

// ================= FORMAT MONEY =================
function formatMoney(amount, amount_num) {
  const num = amount_num || parseAmount(amount);

  if (!num) return "";

  if (num >= 1e9) return (num / 1e9).toFixed(1) + " tỷ USD";
  if (num >= 1e6) return (num / 1e6).toFixed(1) + " triệu USD";

  return num.toLocaleString();
}

// ================= DEADLINE =================
function getDeadlineInfo(deadline) {
  if (!deadline) return "";

  const d = new Date(deadline);
  if (isNaN(d)) return "";

  const diff = (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24);

  if (diff < 0) return "đã hết hạn";
  if (diff <= 7) return "deadline rất gần";
  if (diff <= 30) return "deadline sắp tới";

  return "";
}

// ================= REASON =================
function buildReasoning(fund, index, query) {
  const reasons = [];

  if (index === 0) reasons.push("phù hợp nhất với nhu cầu");

  const rel = relevanceScore(fund, query);
  if (rel > 0) reasons.push("khớp trực tiếp với yêu cầu");

  if ((fund.amount_num || 0) >= 1e7) {
    reasons.push("mức tài trợ tốt");
  }

  const deadlineInfo = getDeadlineInfo(fund.deadline);
  if (deadlineInfo) reasons.push(deadlineInfo);

  return reasons.length
    ? "👉 " + reasons.join(", ")
    : "";
}

// ================= SORT =================
function stableSort(funds) {
  return [...funds].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.amount_num || 0) !== (a.amount_num || 0)) {
      return (b.amount_num || 0) - (a.amount_num || 0);
    }
    return a._idx - b._idx;
  });
}

// ================= BEST PICK =================
function pickBestFund(funds, query) {
  const sorted = [...funds].sort((a, b) => {
    const ra = relevanceScore(a, query);
    const rb = relevanceScore(b, query);

    if (rb !== ra) return rb - ra;
    return b.score - a.score;
  });

  return sorted[0];
}

// ================= RENDER =================
function renderFund(f, index, query) {
  let txt = "";

  if (f.title) txt += `🎓 **${f.title}**\n`;
  if (f.agency) txt += `🏢 ${f.agency}\n`;

  const money = formatMoney(f.amount, f.amount_num);
  if (money) txt += `💰 ${money}\n`;

  if (f.url) txt += `🔎 ${f.url}\n`;

  const reason = buildReasoning(f, index, query);
  if (reason) txt += `${reason}\n`;

  return txt + "\n";
}

// ================= INTRO =================
function buildIntro(question) {
  const q = question.toLowerCase();

  if (q.includes("nafosted")) {
    return "Nếu bạn đang tìm quỹ Nafosted, thì các chương trình tài trợ nghiên cứu cơ bản tại Việt Nam là phù hợp nhất.";
  }

  if (q.includes("ai") || q.includes("data")) {
    return "Với hướng nghiên cứu này, bạn nên ưu tiên các quỹ có tài trợ cho AI và dữ liệu.";
  }

  return "Dưới đây là một số quỹ phù hợp nhất với nhu cầu của bạn.";
}

// ================= BUILD ANSWER =================
function buildAnswer(funds, question) {
  if (!funds.length) {
    return "Không tìm thấy quỹ phù hợp với yêu cầu của bạn.";
  }

  const best = pickBestFund(funds, question);

  let txt = `${buildIntro(question)}\n\n`;

  txt += `🔥 **Quỹ nổi bật nhất:**\n\n`;
  txt += renderFund(best, 0, question);

  funds
    .filter(f => f !== best)
    .forEach((f, i) => {
      txt += `---\n`;
      txt += renderFund(f, i + 1, question);
    });

  return txt;
}

// ================= MAIN =================
export async function runFundAgent(req, question, model_id, topk = 5) {
  try {
    const raw = await runFundSearch(question, model_id, topk);

    if (!raw.length) {
      return {
        answer: "Không tìm thấy quỹ phù hợp.",
        funds: []
      };
    }

    let funds = normalizeFunds(raw);

    // ================= 🔥 HARD FILTER VIETNAM =================
    const q = question.toLowerCase();

    if (q.includes("việt") || q.includes("vietnam")) {
      const vnFunds = funds.filter(f => {
        const t = (f.title + " " + f.text + " " + f.agency).toLowerCase();

        return (
          t.includes("vietnam") ||
          t.includes("việt") ||
          t.includes("nafosted") ||
          t.includes("quỹ phát triển khoa học") ||
          t.includes("khoa học và công nghệ quốc gia")
        );
      });

      if (vnFunds.length > 0) {
        funds = vnFunds;
      }
    }

    funds = stableSort(funds);
    funds = funds.slice(0, MAX_RETURN);

    const answer = buildAnswer(funds, question);

    try {
      addToHistory(req, question, answer);
    } catch {}

    return { answer, funds };

  } catch (err) {
    return {
      answer: "Hệ thống đang gặp lỗi.",
      funds: []
    };
  }
}