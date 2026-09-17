// agents/scholar/scholar.prompt.js

export function buildScholarPrompt(
  question,
  conferences = [],
  journals = [],
  llmContext = {}
) {
  const MAX_HISTORY = 10;
  const MAX_ITEMS = 5;

  // Giới hạn tổng text file đưa vào LLM
  // để tránh prompt quá lớn
  const MAX_DOC_CHARS = 30000;

  const {
    history = [],
    profile = null,
    project = null,
    docs = []
  } = llmContext || {};

  let context = `
Bạn là AI tư vấn học thuật hỗ trợ tra cứu hội thảo và tạp chí khoa học.

QUY TẮC:
- Chỉ sử dụng dữ liệu hội thảo và tạp chí được cung cấp bên dưới
- Không được bịa tên hội thảo, tạp chí, deadline, quartile hoặc thông tin học thuật
- Có thể sử dụng hồ sơ người dùng để cá nhân hóa câu trả lời khi phù hợp
- Có thể sử dụng thông tin dự án/đề tài khi câu hỏi liên quan đến dự án
- Có thể sử dụng nội dung file người dùng cung cấp để hiểu chủ đề nghiên cứu
- Sử dụng lịch sử hội thoại để hiểu câu hỏi nối tiếp
- Nếu hồ sơ, dự án, file hoặc lịch sử không liên quan đến câu hỏi hiện tại thì bỏ qua
- Ưu tiên kết quả ở trên vì đã được hệ thống xếp hạng theo độ liên quan
- Khi tư vấn hội thảo, ưu tiên hội thảo còn hạn nộp bài nếu phù hợp
- Phân biệt rõ hạn nộp bài (deadline) và ngày diễn ra (event date)
- Không suy diễn thông tin không có trong dữ liệu
- Trả lời bằng tiếng Việt, rõ ràng và súc tích
`;

  // ================= USER PROFILE =================
  if (profile) {
    const directions = Array.isArray(profile.direction)
      ? profile.direction.filter(Boolean).join(", ")
      : "";

    context += "\n=== HỒ SƠ NGƯỜI DÙNG ===\n";

    if (profile.full_name) {
      context += `Họ tên: ${profile.full_name}\n`;
    }

    if (profile.position) {
      context += `Chức vụ/Học vị: ${profile.position}\n`;
    }

    if (profile.academic_title) {
      context += `Chức danh: ${profile.academic_title}\n`;
    }

    if (profile.academic_degree) {
      context += `Học vị: ${profile.academic_degree}\n`;
    }

    if (profile.department_name) {
      context += `Đơn vị: ${profile.department_name}\n`;
    }

    if (directions) {
      context += `Hướng nghiên cứu: ${directions}\n`;
    }
  }

  // ================= PROJECT =================
  if (project) {
    context += "\n=== DỰ ÁN / ĐỀ TÀI ĐANG MỞ ===\n";

    if (project.name) {
      context += `Tên: ${project.name}\n`;
    }

    if (project.description) {
      context += `Mô tả: ${project.description}\n`;
    }
  }

  // ================= DOCUMENTS =================
  if (Array.isArray(docs) && docs.length) {
    context += "\n=== TÀI LIỆU NGƯỜI DÙNG CUNG CẤP ===\n";

    let remainingChars = MAX_DOC_CHARS;

    for (const doc of docs) {
      if (remainingChars <= 0) break;

      const rawText =
        typeof doc?.text === "string"
          ? doc.text.trim()
          : "";

      if (!rawText) continue;

      const text = rawText.slice(0, remainingChars);

      remainingChars -= text.length;

      context += `\n[FILE: ${doc.name || "document"}]\n`;
      context += `${text}\n`;
    }

    if (remainingChars <= 0) {
      context += "\n[Phần nội dung tài liệu còn lại đã được lược bớt do giới hạn ngữ cảnh]\n";
    }
  }

  // ================= HISTORY =================
  if (Array.isArray(history) && history.length) {
    context += "\n=== LỊCH SỬ HỘI THOẠI ===\n";

    history
      .slice(-MAX_HISTORY)
      .forEach(h => {
        if (!h?.content) return;

        const role =
          h.role === "user"
            ? "User"
            : "Assistant";

        context += `${role}: ${h.content}\n`;
      });
  }

  // ================= STATUS =================
  function getStatus(c) {
    const now = Date.now();

    const deadline = c.deadline
      ? new Date(c.deadline).getTime()
      : null;

    const start = c.start_date
      ? new Date(c.start_date).getTime()
      : null;

    if (deadline && !isNaN(deadline)) {
      const diff =
        (deadline - now) /
        (1000 * 60 * 60 * 24);

      if (diff > 30) {
        return "submission_open";
      }

      if (diff > 0) {
        return "submission_soon";
      }
    }

    if (
      deadline &&
      !isNaN(deadline) &&
      deadline < now
    ) {
      if (start && !isNaN(start)) {
        const diffStart =
          (start - now) /
          (1000 * 60 * 60 * 24);

        if (diffStart > 0) {
          return "upcoming_event";
        }

        return "past_event";
      }

      return "submission_closed";
    }

    if (
      start &&
      !isNaN(start)
    ) {
      if (start > now) {
        return "upcoming_event";
      }

      return "past_event";
    }

    return "unknown";
  }

  // ================= CONFERENCES =================
  if (
    Array.isArray(conferences) &&
    conferences.length
  ) {
    context += "\n=== DỮ LIỆU HỘI THẢO ===\n";

    conferences
      .slice(0, MAX_ITEMS)
      .forEach((c, i) => {
        const location =
          [c.city, c.country]
            .filter(Boolean)
            .join(", ") || "N/A";

        const fields =
          Array.isArray(c.fields) &&
          c.fields.length
            ? c.fields.join(", ")
            : Array.isArray(c.topics) &&
              c.topics.length
              ? c.topics.join(", ")
              : "N/A";

        context +=
          `[C${i + 1}] ` +
          `${c.name || c.title || c.acronym || ""}` +
          ` | ${location}` +
          ` | deadline: ${c.deadline || "N/A"}` +
          ` | event: ${c.start_date || "N/A"}` +
          ` | status: ${getStatus(c)}` +
          ` | field: ${fields}\n`;
      });
  }

  // ================= JOURNALS =================
  if (
    Array.isArray(journals) &&
    journals.length
  ) {
    context += "\n=== DỮ LIỆU TẠP CHÍ ===\n";

    journals
      .slice(0, MAX_ITEMS)
      .forEach((j, i) => {
        const fields =
          Array.isArray(j.fields) &&
          j.fields.length
            ? j.fields.join(", ")
            : Array.isArray(j.categories) &&
              j.categories.length
              ? j.categories.join(", ")
              : Array.isArray(j.areas) &&
                j.areas.length
                ? j.areas.join(", ")
                : "N/A";

        context +=
          `[J${i + 1}] ` +
          `${j.title || ""}` +
          ` | publisher: ${j.publisher || "N/A"}` +
          ` | quartile: ${j.sjr_best_quartile || "N/A"}` +
          ` | field: ${fields}` +
          ` | country: ${j.country || "N/A"}\n`;
      });
  }

  // ================= QUESTION =================
  context += `
=== CÂU HỎI HIỆN TẠI ===
${question}
`;

  return context.trim();
}