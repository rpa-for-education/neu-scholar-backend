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
      amount: Number(p.amount) || 0,
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

  // 🔥 PHÂN TÍCH MỞ ĐẦU
  let txt = `Dựa trên yêu cầu *"${question}"*, hệ thống đã phân tích và lựa chọn các nguồn tài trợ phù hợp dựa trên mức độ liên quan nội dung, quy mô kinh phí và tính khả thi về thời gian. `;
  
  txt += `Các quỹ bên dưới chủ yếu tập trung vào lĩnh vực liên quan, trong đó ưu tiên những chương trình có tính ứng dụng cao và khả năng triển khai thực tế. `;
  
  txt += `Một số nguồn tài trợ đến từ các tổ chức uy tín, giúp đảm bảo độ tin cậy và tiềm năng hỗ trợ nghiên cứu dài hạn. `;
  
  txt += `Bạn nên ưu tiên các quỹ có mức tài trợ tốt và còn thời hạn nộp hồ sơ phù hợp.\n\n`;

  // 🔥 BEST FUND
  txt += `🔥 **Quỹ nổi bật nhất:**\n\n`;
  txt += `🎓 **${best.title}**\n`;
  txt += `🏢 Cơ quan: ${best.agency || "N/A"}\n`;
  txt += `💰 Kinh phí: ${formatMoney(best.amount)}\n`;
  txt += `🔎 Chi tiết: ${best.url || "N/A"}\n`;
  txt += `${buildReasoning(best, 0)}\n\n`;

  // 🔥 DANH SÁCH KHÁC (không tiêu đề cứng)
  funds.slice(1).forEach((f, i) => {
    txt += `---\n`;
    txt += `🎓 **${f.title}**\n`;
    txt += `🏢 Cơ quan: ${f.agency || "N/A"}\n`;
    txt += `💰 Kinh phí: ${formatMoney(f.amount)}\n`;
    txt += `🔎 Chi tiết: ${f.url || "N/A"}\n`;
    txt += `${buildReasoning(f, i + 1)}\n\n`;
  });

  // 🔥 KẾT LUẬN
  txt += `---\n💡 **Gợi ý thêm cho giảng viên:**\n`;
  txt += `- Ưu tiên các quỹ có mức tài trợ lớn và nguồn cấp uy tín\n`;
  txt += `- Kiểm tra kỹ deadline và điều kiện tham gia (eligibility)\n`;
  txt += `- Có thể mở rộng sang NSF, EU Horizon hoặc quỹ quốc gia\n`;

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