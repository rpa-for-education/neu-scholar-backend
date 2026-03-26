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
      title: p.title || "",   // 🔥 KHÔNG N/A
      agency: p.agency || "",
      deadline: p.deadline || "",
      amount: p.amount || "",
      amount_num,
      url: p.url || "",
      score: Math.max(0, Math.min(1, Number(r.finalScore ?? r.score ?? 0))),
      _idx: idx
    };
  });
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

// ================= REASONING =================
function buildReasoning(fund, index) {
  const reasons = [];

  if (index === 0) reasons.push("phù hợp tổng thể tốt nhất");

  if ((fund.amount_num || 0) >= 1e7) {
    reasons.push("mức tài trợ cao");
  }

  const deadlineInfo = getDeadlineInfo(fund.deadline);
  if (deadlineInfo) reasons.push(deadlineInfo);

  if ((fund.agency || "").toLowerCase().includes("nsf")) {
    reasons.push("nguồn tài trợ uy tín (NSF)");
  }

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

// ================= RENDER 1 FUND =================
function renderFund(f, index) {
  let txt = "";

  // 🔥 title bắt buộc
  if (f.title) {
    txt += `🎓 **${f.title}**\n`;
  }

  if (f.agency) {
    txt += `🏢 ${f.agency}\n`;
  }

  const money = formatMoney(f.amount, f.amount_num);
  if (money) {
    txt += `💰 ${money}\n`;
  }

  if (f.url) {
    txt += `🔎 ${f.url}\n`;
  }

  const reason = buildReasoning(f, index);
  if (reason) {
    txt += `${reason}\n`;
  }

  return txt + "\n";
}

// ================= BUILD ANSWER =================
function buildAnswer(funds, question) {
  if (!funds.length) {
    return "Không tìm thấy quỹ phù hợp với yêu cầu của bạn.";
  }

  const best = funds[0];

  let txt = `Dựa trên yêu cầu *"${question}"*, hệ thống đã chọn các quỹ phù hợp nhất dựa trên mức độ liên quan, kinh phí và thời hạn.\n\n`;

  // BEST
  txt += `🔥 **Quỹ phù hợp nhất:**\n\n`;
  txt += renderFund(best, 0);

  // OTHERS
  funds.slice(1).forEach((f, i) => {
    txt += `---\n`;
    txt += renderFund(f, i + 1);
  });

  txt += `---\n💡 **Gợi ý:**\n`;
  txt += `- Ưu tiên quỹ có funding cao & deadline phù hợp\n`;
  txt += `- Kiểm tra eligibility trước khi apply\n`;
  txt += `- Có thể mở rộng sang NSF, EU Horizon\n`;

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
    } catch {
      console.warn("⚠️ history fail");
    }

    return {
      answer,
      funds
    };

  } catch (err) {
    console.error("❌ fund agent error:", err.message);

    return {
      answer: "Hệ thống đang gặp lỗi khi tìm quỹ.",
      funds: []
    };
  }
}