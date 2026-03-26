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
- Ưu tiên:
  1. Liên quan nội dung
  2. Funding cao
  3. Deadline hợp lý

- Lưu ý:
  + Danh sách đã được xếp hạng sơ bộ (F1 tốt hơn F2...)
  + Chỉ cần chọn lại + giải thích

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