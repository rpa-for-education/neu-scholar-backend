// agents/fund/fund.service.js

import { runFundSearch } from "./fund.agent.js";
import { addToHistory } from "../../middlewares/session.js";

// ================= NORMALIZE =================
function normalizeFunds(arr) {
  return arr.map(r => {
    const p = r.payload || r;
    return {
      title: p.title,
      agency: p.agency,
      deadline: p.deadline,
      amount: p.amount,
      url: p.url
    };
  });
}

// ================= FORMAT MONEY =================
function formatMoney(v) {
  if (!v) return "Không rõ";

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

  if (fund.agency?.toLowerCase().includes("nsf")) {
    reasons.push("nguồn tài trợ uy tín (NSF)");
  }

  return reasons.length
    ? "👉 Lý do: " + reasons.join(", ")
    : "";
}

// ================= MAIN ANSWER =================
function buildAnswer(funds, question) {
  if (!funds.length) {
    return "Không tìm thấy quỹ phù hợp với yêu cầu của bạn.";
  }

  const best = funds[0];

  let txt = `🎯 **Gợi ý quỹ nghiên cứu phù hợp**\n\n`;

  txt += `Dựa trên yêu cầu: *"${question}"*, hệ thống đề xuất các quỹ sau:\n\n`;

  // 🔥 BEST FUND
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

  // 🔥 KẾT LUẬN (QUAN TRỌNG)
  txt += `\n---\n💡 **Gợi ý thêm cho giảng viên:**\n`;
  txt += `- Ưu tiên các quỹ có funding lớn và agency uy tín\n`;
  txt += `- Kiểm tra kỹ deadline và eligibility trước khi nộp\n`;
  txt += `- Có thể mở rộng tìm kiếm sang NSF, EU Horizon, hoặc các quỹ quốc gia\n`;

  return txt;
}

// ================= MAIN =================
export async function runFundAgent(req, question, model_id, topk = 5) {
  const raw = await runFundSearch(question, model_id, topk);

  if (!raw.length) {
    return {
      answer: "Không tìm thấy quỹ phù hợp.",
      funds: []
    };
  }

  const funds = normalizeFunds(raw);

  const answer = buildAnswer(funds, question);

  try {
    addToHistory(req, question, answer);
  } catch {}

  return {
    answer,
    funds
  };
}