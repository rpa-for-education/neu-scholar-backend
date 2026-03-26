export function buildScholarPrompt(
  question,
  conferences = [],
  journals = [],
  history = []
) {
  // 🔥 LIMIT (cực quan trọng)
  const MAX_HISTORY = 3;
  const MAX_ITEMS = 5;

  let context = `
Bạn là AI tư vấn học thuật (conference + journal).

QUY TẮC:
- Chỉ dùng dữ liệu được cung cấp
- Không được bịa
- Trả lời ngắn gọn (tối đa 2-3 câu)
- Không liệt kê danh sách
- Không markdown
`;

  // ================= HISTORY =================
  if (history.length) {
    context += "\n=== LỊCH SỬ ===\n";

    history.slice(-MAX_HISTORY).forEach(h => {
      context += `${h.role === "user" ? "User" : "Assistant"}: ${h.content}\n`;
    });
  }

  // ================= CONFERENCES =================
  if (conferences.length) {
    context += "\n=== CONFERENCES ===\n";

    conferences.slice(0, MAX_ITEMS).forEach((c, i) => {
      context += `[C${i + 1}] ${c.name || c.title || ""}  
- Location: ${[c.city, c.country].filter(Boolean).join(", ")}  
- Deadline: ${c.deadline || "N/A"}  
- Link: ${c.url || "N/A"}\n`;
    });
  }

  // ================= JOURNALS =================
  if (journals.length) {
    context += "\n=== JOURNALS ===\n";

    journals.slice(0, MAX_ITEMS).forEach((j, i) => {
      context += `[J${i + 1}] ${j.title || ""}  
- Publisher: ${j.publisher || "N/A"}  
- Quartile: ${j.sjr_best_quartile || "N/A"}  
- Link: ${j.url || j.scimago_link || "N/A"}\n`;
    });
  }

  // ================= QUESTION =================
  context += `\n=== CÂU HỎI ===\n${question}\n`;

  return context;
}