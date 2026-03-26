// agents/fund/fund.service.js

import { runFundSearch } from "./fund.agent.js";
import { addToHistory } from "../../middlewares/session.js";

const MAX_RETURN = 5;

// ================= NORMALIZE =================
function normalizeFunds(arr) {
  return arr.map(r => {
    const p = r.payload || r;

    return {
      title: p.title || "N/A",
      agency: p.agency || "",
      deadline: p.deadline || "",
      amount: Number(p.amount) || 0, // 🔥 fix type
      url: p.url || ""
    };
  });
}

// ================= FORMAT MONEY =================
function formatMoney(v) {
  if (!v || isNaN(v)) return "Không rõ";

  if (v >= 1e9) return (v / 1e9).toFixed(1) + " tỷ USD";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + " triệu USD";

  return v.toLocaleString();
}

// ================= REASONING =================
function buildReasoning(fund, index) {
  const reasons = [];

  if (index === 0) {
    reasons.push("phù hợp tổng thể tốt nhất");
  }

  if (fund.amount >= 1e7) {
    reasons.push("mức tài trợ cao");
  }

  if (!fund.deadline) {
    reasons.push("chưa rõ deadline (cần kiểm tra thêm)");
  }

  if ((fund.agency || "").toLowerCase().includes("nsf")) {
    reasons.push("nguồn tài trợ uy tín (NSF)");
  }

  return reasons.length
    ? "👉 Lý do: " + reasons.join(", ")
    : "";
}

// ================= SORT SAFE =================
function sortFunds(funds) {
  return [...funds].sort((a, b) => (b.amount || 0) - (a.amount || 0));
}

// ================= MAIN ANSWER =================
function buildAnswer(funds, question) {
  if (!funds.length) {
    return "Không tìm thấy quỹ phù hợp với yêu cầu của bạn.";
  }

  const best = funds[0];

  let txt = `🎯 **Gợi ý quỹ nghiên cứu phù hợp**\n\n`;

  txt += `Dựa trên yêu cầu: *"${question}"*, hệ thống đề xuất các quỹ sau:\n\n`;

  // 🔥 BEST
  txt += `🔥 **Quỹ nổi bật nhất:**\n`;
  txt += `👉 ${best.title}\n`;
  txt += `- Cơ quan: ${best.agency || "N/A"}\n`;
  txt += `- Kinh phí: ${formatMoney(best.amount)}\n`;
  txt += `- 🔗 ${best.url || "N/A"}\n`;
  txt += `${buildReasoning(best, 0)}\n\n`;

  // 🔥 LIST
  txt += `---\n### 📊 Các quỹ liên quan khác:\n`;

  funds.forEach((f, i) => {
    txt += `
[F${i + 1}] ${f.title}
- Cơ quan: ${f.agency || "N/A"}
- Kinh phí: ${formatMoney(f.amount)}
- 🔗 ${f.url || "N/A"}
${buildReasoning(f, i)}
`;
  });

  // 🔥 KẾT LUẬN
  txt += `\n---\n💡 **Gợi ý thêm cho giảng viên:**\n`;
  txt += `- Ưu tiên các quỹ có funding lớn và agency uy tín\n`;
  txt += `- Kiểm tra kỹ deadline và eligibility trước khi nộp\n`;
  txt += `- Có thể mở rộng sang NSF, EU Horizon, quỹ quốc gia\n`;

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

    // 🔥 SORT SAFE
    funds = sortFunds(funds);

    // 🔥 LIMIT OUTPUT
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