export function buildScholarPrompt(question, conferences = [], journals = [], history = []) {
  let context = `
Bạn là AI tư vấn học thuật (conference + journal).
Chỉ được dùng dữ liệu bên dưới. Không bịa.
`;

  if (history.length) {
    context += "\n=== LỊCH SỬ ===\n";
    history.forEach(h => {
      context += `${h.role === "user" ? "User" : "Assistant"}: ${h.content}\n`;
    });
  }

  if (conferences.length) {
    context += "\n=== CONFERENCES ===\n";
    conferences.forEach((c, i) => {
      context += `[C${i + 1}] ${c.name || c.title || ""} | ${c.country || ""} | ${c.deadline || ""}\n`;
    });
  }

  if (journals.length) {
    context += "\n=== JOURNALS ===\n";
    journals.forEach((j, i) => {
      context += `[J${i + 1}] ${j.title || ""} | ${j.publisher || ""} | ${j.quartile || ""}\n`;
    });
  }

  context += `\nCâu hỏi: ${question}\n`;

  return context;
}