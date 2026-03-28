// fund.service.js - FINAL PRO (SMART BEST + BETTER UX)

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

// ================= 🔥 INTENT MATCH (FIX NAFOSTED) =================
function relevanceScore(fund, query) {
  const t = (fund.title + " " + fund.text + " " + fund.agency).toLowerCase();
  const q = query.toLowerCase();

  let score = 0;

  // 🔥 FIX: nhận diện Nafosted (tiếng Việt + tiếng Anh)
  if (
    q.includes("nafosted") &&
    (
      t.includes("nafosted") ||
      t.includes("khoa học và công nghệ quốc gia") ||
      t.includes("quỹ phát triển khoa học") ||
      t.includes("national foundation") ||
      t.includes("vietnam")
    )
  ) {
    score += 2;
  }

  // 🔥 giữ logic cũ
  if (q.includes("việt") || q.includes("vietnam")) {
    if (t.includes("vietnam")) score += 1;
  }

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

// ================= 🔥 REASONING =================
function buildReasoning(fund, index, query) {
  const reasons = [];

  if (index === 0) reasons.push("phù hợp tổng thể tốt nhất");

  const rel = relevanceScore(fund, query);
  if (rel > 0) reasons.push("phù hợp trực tiếp với yêu cầu");

  if ((fund.amount_num || 0) >= 1e7) {
    reasons.push("mức tài trợ cao");
  }

  const deadlineInfo = getDeadlineInfo(fund.deadline);
  if (deadlineInfo) reasons.push(deadlineInfo);

  return reasons.length
    ? "👉 Lý do: " + reasons.join(", ")
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

// ================= 🔥 BEST PICK =================
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

// ================= INSIGHT =================
function buildInsight(funds) {
  const highFunding = funds.filter(f => (f.amount_num || 0) >= 1e7);

  let insights = [];

  if (highFunding.length) {
    insights.push(`${highFunding.length} quỹ có mức tài trợ cao`);
  }

  return insights.length ? "👉 " + insights.join(". ") : "";
}

// ================= BUILD ANSWER =================
function buildAnswer(funds, question) {
  if (!funds.length) {
    return "Không tìm thấy quỹ phù hợp với yêu cầu của bạn.";
  }

  const best = pickBestFund(funds, question);

  let txt = `Dựa trên yêu cầu *"${question}"*, hệ thống đã chọn các quỹ phù hợp nhất.\n\n`;

  const insight = buildInsight(funds);
  if (insight) txt += insight + "\n\n";

  txt += `🔥 **Quỹ phù hợp nhất:**\n\n`;
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