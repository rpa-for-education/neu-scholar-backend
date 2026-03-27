// fund.prompt.js - ENHANCED PROMPT (SAFE + STRONG CONTROL)

export function buildFundPrompt(question, funds = [], history = []) {
  let context = `
Bạn là chuyên gia tư vấn quỹ nghiên cứu.

⚠️ QUY TẮC BẮT BUỘC:
- CHỈ được sử dụng dữ liệu trong === FUNDS ===
- MỖI quỹ phải tham chiếu bằng ID [F1], [F2], ...
- TUYỆT ĐỐI KHÔNG được tạo quỹ mới
- KHÔNG được suy đoán ngoài dữ liệu
- Nếu không đủ thông tin → trả lời: "không đủ dữ liệu"

---

🎯 NHIỆM VỤ:
- Chọn các quỹ PHÙ HỢP NHẤT với câu hỏi
- Ưu tiên theo thứ tự:
  1. Mức độ liên quan nội dung (QUAN TRỌNG NHẤT)
  2. Funding cao
  3. Deadline hợp lý (còn hạn hoặc gần hạn)

- ⚠️ QUAN TRỌNG:
  + Danh sách đã được xếp hạng sẵn (F1 tốt hơn F2, F2 tốt hơn F3...)
  + CHỈ thay đổi thứ tự nếu có lý do RẤT RÕ RÀNG
  + Nếu các quỹ tương đương → giữ nguyên thứ tự ban đầu

---

📌 CÁCH VIẾT Reason:
- Ngắn gọn (1 dòng)
- Không lặp lại thông tin đã có
- Tập trung vào:
  + độ phù hợp
  + funding
  + deadline

---

📌 OUTPUT (BẮT BUỘC - KHÔNG THAY ĐỔI FORMAT):

TOP_FUNDS:
- [F?] Tên quỹ | Agency
  Reason: ...

- [F?] Tên quỹ | Agency
  Reason: ...

BEST_FUND:
[F?] Tên quỹ
Reason: ...

---

`;

  // ================= HISTORY =================
  if (history.length) {
    context += "\n=== HISTORY ===\n";
    history.slice(-3).forEach((h) => {
      context += `${h.role}: ${h.content}\n`;
    });
  }

  // ================= FUNDS =================
  if (funds.length) {
    context += "\n=== FUNDS ===\n";

    funds.forEach((f, i) => {
      context += `
[F${i + 1}]
Title: ${f.title}
Agency: ${f.agency || "N/A"}
Deadline: ${f.deadline || "N/A"}
Funding: ${f.amount || "N/A"}
Summary: ${(f.text || "").slice(0, 180)}
`;
    });
  }

  // ================= QUESTION =================
  context += `\n=== QUESTION ===\n${question}\n`;

  return context;
}