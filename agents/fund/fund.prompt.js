// agents/fund/fund.prompt.js

export function buildFundPrompt(question, funds = [], history = []) {
  let context = `
Bạn là AI tư vấn quỹ nghiên cứu.

⚠️ QUY TẮC BẮT BUỘC:
- CHỈ được sử dụng dữ liệu trong phần === FUNDS ===
- TUYỆT ĐỐI KHÔNG được sử dụng kiến thức bên ngoài
- KHÔNG được tự tạo quỹ mới
- Nếu dữ liệu không đủ → phải nói rõ

---

🎯 YÊU CẦU:
- Tìm các quỹ PHÙ HỢP NHẤT với câu hỏi
- Được phép suy luận:
  "automation" ≈ AI, workflow, cloud, system, process
- Ưu tiên:
  + liên quan AI / automation
  + funding lớn
  + deadline hợp lý

---

📌 FORMAT TRẢ LỜI:

1. Danh sách quỹ phù hợp (bullet)
- Tên quỹ
- Agency
- Vì sao phù hợp

2. Đề xuất quỹ tốt nhất

---

`;

  if (history.length) {
    context += "\n=== HISTORY ===\n";
    history.forEach((h) => {
      context += `${h.role}: ${h.content}\n`;
    });
  }

  if (funds.length) {
    context += "\n=== FUNDS ===\n";

    funds.forEach((f, i) => {
      context += `
[F${i + 1}]
Title: ${f.title}
Agency: ${f.agency}
Deadline: ${f.deadline}
Funding: ${f.amount}
Summary: ${f.text?.slice(0, 500)}
`;
    });
  }

  context += `\n=== QUESTION ===\n${question}\n`;

  return context;
}