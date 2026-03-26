// scholar.prompt.js
export function buildScholarPrompt(
  question,
  conferences = [],
  journals = [],
  history = []
) {
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
- Ưu tiên kết quả ở trên (top relevance)
- Ưu tiên hội thảo còn hạn nộp bài
- Phân biệt rõ: hạn nộp bài (deadline) và ngày diễn ra (event date)
- Tóm tắt insight chính, không copy dữ liệu
`;

  // ================= HISTORY =================
  if (history.length) {
    context += "\n=== LỊCH SỬ ===\n";

    history.slice(-MAX_HISTORY).forEach(h => {
      context += `${h.role === "user" ? "User" : "Assistant"}: ${h.content}\n`;
    });
  }

  // ================= 🔥 STATUS =================
  function getStatus(c) {
    const now = Date.now();

    const deadline = c.deadline ? new Date(c.deadline).getTime() : null;
    const start = c.start_date ? new Date(c.start_date).getTime() : null;

    if (deadline) {
      const diff = (deadline - now) / (1000 * 60 * 60 * 24);

      if (diff > 30) return "submission_open";
      if (diff > 0) return "submission_soon";
    }

    if (deadline && deadline < now) {
      if (start) {
        const diffStart = (start - now) / (1000 * 60 * 60 * 24);

        if (diffStart > 0) return "upcoming_event";
        return "past_event";
      }

      return "submission_closed";
    }

    return "unknown";
  }

  // ================= CONFERENCES =================
  if (conferences.length) {
    context += "\n=== CONFERENCES ===\n";

    conferences.slice(0, MAX_ITEMS).forEach((c, i) => {
      context += `[C${i + 1}] ${c.name || c.title || ""} | ${
        [c.city, c.country].filter(Boolean).join(", ") || "N/A"
      } | deadline: ${c.deadline || "N/A"} | event: ${
        c.start_date || "N/A"
      } | status: ${getStatus(c)} | field: ${
        (c.fields || []).join(", ") || "N/A"
      }\n`;
    });
  }

  // ================= JOURNALS =================
  if (journals.length) {
    context += "\n=== JOURNALS ===\n";

    journals.slice(0, MAX_ITEMS).forEach((j, i) => {
      context += `[J${i + 1}] ${j.title || ""} | ${j.publisher || "N/A"} | ${
        j.sjr_best_quartile || "N/A"
      } | field: ${(j.fields || []).join(", ") || "N/A"} | ${
        j.country || "N/A"
      }\n`;
    });
  }

  // ================= QUESTION =================
  context += `\n=== CÂU HỎI ===\n${question}\n`;

  return context;
}