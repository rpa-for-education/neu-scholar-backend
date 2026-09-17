// agents/scholar/scholar.prompt.js

// =====================================================
// CONFIG
// =====================================================

const MAX_ITEMS = 5;
const MAX_HISTORY = 4;
const MAX_HISTORY_CHARS_PER_ITEM = 500;
const MAX_PROJECT_CHARS = 1500;
const MAX_DOC_CHARS = 4000;


// =====================================================
// TEXT UTILS
// =====================================================

function normalizeText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeForDetection(value) {
  return normalizeText(value).toLowerCase();
}


function truncate(value, maxChars) {
  const text = normalizeText(value);

  if (!text || text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars).trim()}…`;
}


function joinArray(value) {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .filter(Boolean)
    .map(normalizeText)
    .filter(Boolean)
    .join(", ");
}


// =====================================================
// CONTEXT INTENT DETECTION
// Chỉ đưa context vào prompt khi câu hỏi thực sự cần.
// =====================================================

function containsAny(question, patterns) {
  const q = normalizeForDetection(question);

  if (!q) {
    return false;
  }

  return patterns.some(
    pattern => q.includes(pattern)
  );
}


function needsHistory(question) {
  return containsAny(question, [
    "ở trên",
    "bên trên",
    "vừa rồi",
    "trước đó",
    "trước đây",
    "trong số đó",
    "trong các",
    "các kết quả trên",
    "kết quả trên",
    "danh sách trên",
    "cái nào",
    "cái thứ",
    "mục nào",
    "mục thứ",
    "hội thảo đó",
    "hội thảo này",
    "tạp chí đó",
    "tạp chí này",
    "nó ",
    "chúng ",
    "so sánh chúng",
    "so sánh các kết quả",
    "kết quả nào"
  ]);
}


function needsProfile(question) {
  return containsAny(question, [
    "phù hợp với tôi",
    "phù hợp cho tôi",
    "của tôi",
    "hướng nghiên cứu của tôi",
    "lĩnh vực của tôi",
    "chuyên môn của tôi",
    "hồ sơ của tôi",
    "profile của tôi",
    "đơn vị của tôi",
    "chức danh của tôi",
    "học vị của tôi",
    "recommend cho tôi",
    "gợi ý cho tôi"
  ]);
}


function needsProject(question) {
  return containsAny(question, [
    "dự án",
    "đề tài",
    "project",
    "nghiên cứu đang làm",
    "nghiên cứu của tôi",
    "đề tài của tôi",
    "dự án của tôi",
    "phù hợp với đề tài",
    "phù hợp với dự án"
  ]);
}


function needsDocuments(question) {
  return containsAny(question, [
    "tài liệu",
    "file",
    "document",
    "bài báo",
    "bài viết",
    "bản thảo",
    "manuscript",
    "paper",
    "tệp",
    "đính kèm",
    "upload",
    "tôi gửi",
    "đã gửi",
    "nội dung này",
    "tài liệu này",
    "file này"
  ]);
}


// =====================================================
// DATE / CONFERENCE STATUS
// =====================================================

function safeTime(value) {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();

  return Number.isFinite(time)
    ? time
    : null;
}


function getStatus(conference) {
  const now = Date.now();

  const deadline =
    safeTime(conference?.deadline);

  const start =
    safeTime(conference?.start_date);

  if (deadline !== null) {
    const diffDays =
      (deadline - now) /
      86_400_000;

    if (diffDays > 30) {
      return "submission_open";
    }

    if (diffDays > 0) {
      return "submission_soon";
    }

    if (start !== null) {
      return start > now
        ? "upcoming_event"
        : "past_event";
    }

    return "submission_closed";
  }

  if (start !== null) {
    return start > now
      ? "upcoming_event"
      : "past_event";
  }

  return "unknown";
}


// =====================================================
// OPTIONAL CONTEXT
// =====================================================

function buildProfileContext(profile) {
  if (!profile) {
    return "";
  }

  const fields = [
    ["Họ tên", profile.full_name],
    ["Vị trí/Chức vụ", profile.position],
    ["Chức danh khoa học", profile.academic_title],
    ["Học vị", profile.academic_degree],
    ["Đơn vị", profile.department_name],
    ["Hướng nghiên cứu", joinArray(profile.direction)]
  ];

  const lines = fields
    .filter(([, value]) => normalizeText(value))
    .map(
      ([label, value]) =>
        `${label}: ${normalizeText(value)}`
    );

  return lines.length
    ? [
        "=== HỒ SƠ NGƯỜI DÙNG ===",
        ...lines
      ].join("\n")
    : "";
}


function buildProjectContext(project) {
  if (!project) {
    return "";
  }

  const name =
    normalizeText(project?.name);

  const description =
    truncate(
      project?.description,
      MAX_PROJECT_CHARS
    );

  const lines = [];

  if (name) {
    lines.push(`Tên: ${name}`);
  }

  if (description) {
    lines.push(`Mô tả: ${description}`);
  }

  return lines.length
    ? [
        "=== DỰ ÁN / ĐỀ TÀI ===",
        ...lines
      ].join("\n")
    : "";
}


function buildHistoryContext(history) {
  if (!Array.isArray(history)) {
    return "";
  }

  const items = history
    .filter(
      item =>
        item &&
        ["user", "assistant"].includes(item.role) &&
        typeof item.content === "string" &&
        item.content.trim()
    )
    .slice(-MAX_HISTORY)
    .map(item => {
      const role =
        item.role === "user"
          ? "User"
          : "Assistant";

      return `${role}: ${truncate(
        item.content,
        MAX_HISTORY_CHARS_PER_ITEM
      )}`;
    });

  return items.length
    ? [
        "=== HỘI THOẠI GẦN NHẤT ===",
        ...items
      ].join("\n")
    : "";
}


function buildDocumentsContext(docs) {
  if (!Array.isArray(docs) || !docs.length) {
    return "";
  }

  const lines = [
    "=== TÀI LIỆU NGƯỜI DÙNG ==="
  ];

  let remaining = MAX_DOC_CHARS;
  let truncated = false;

  for (const doc of docs) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    const raw =
      typeof doc?.text === "string"
        ? doc.text.trim()
        : "";

    if (!raw) {
      continue;
    }

    const name =
      normalizeText(doc?.name) ||
      "document";

    const text =
      raw.slice(0, remaining);

    if (text.length < raw.length) {
      truncated = true;
    }

    remaining -= text.length;

    lines.push(
      `[FILE: ${name}]`,
      text
    );
  }

  if (lines.length === 1) {
    return "";
  }

  if (truncated) {
    lines.push(
      "[Một phần tài liệu đã được lược bớt do giới hạn ngữ cảnh.]"
    );
  }

  return lines.join("\n");
}


// =====================================================
// RETRIEVAL CONTEXT
// =====================================================

function buildConferenceContext(conferences) {
  if (
    !Array.isArray(conferences) ||
    !conferences.length
  ) {
    return "";
  }

  const items = conferences
    .slice(0, MAX_ITEMS)
    .map((conference, index) => {
      const title =
        normalizeText(
          conference?.name ||
          conference?.title ||
          conference?.acronym
        ) || "N/A";

      const location =
        [
          conference?.city,
          conference?.country
        ]
          .map(normalizeText)
          .filter(Boolean)
          .join(", ") ||
        "N/A";

      const fields =
        joinArray(conference?.fields) ||
        joinArray(conference?.topics) ||
        "N/A";

      const deadline =
        normalizeText(
          conference?.deadline
        ) || "N/A";

      const event =
        normalizeText(
          conference?.start_date
        ) || "N/A";

      const url =
        normalizeText(
          conference?.cfp_link ||
          conference?.url ||
          conference?.link ||
          conference?.website
        ) || "N/A";

      return (
        `[C${index + 1}] ${title}` +
        ` | location: ${location}` +
        ` | deadline: ${deadline}` +
        ` | event: ${event}` +
        ` | status: ${getStatus(conference)}` +
        ` | field: ${fields}` +
        ` | url: ${url}`
      );
    });

  return [
    "=== HỘI THẢO TỪ HỆ THỐNG ===",
    ...items
  ].join("\n");
}


function buildJournalContext(journals) {
  if (
    !Array.isArray(journals) ||
    !journals.length
  ) {
    return "";
  }

  const items = journals
    .slice(0, MAX_ITEMS)
    .map((journal, index) => {
      const title =
        normalizeText(journal?.title) ||
        "N/A";

      const publisher =
        normalizeText(journal?.publisher) ||
        "N/A";

      const quartile =
        normalizeText(
          journal?.sjr_best_quartile
        ) || "N/A";

      const fields =
        joinArray(journal?.fields) ||
        joinArray(journal?.categories) ||
        joinArray(journal?.areas) ||
        "N/A";

      const country =
        normalizeText(journal?.country) ||
        "N/A";

      const url =
        normalizeText(
          journal?.scimago_link ||
          journal?.url
        ) || "N/A";

      return (
        `[J${index + 1}] ${title}` +
        ` | publisher: ${publisher}` +
        ` | quartile: ${quartile}` +
        ` | field: ${fields}` +
        ` | country: ${country}` +
        ` | url: ${url}`
      );
    });

  return [
    "=== TẠP CHÍ TỪ HỆ THỐNG ===",
    ...items
  ].join("\n");
}


// =====================================================
// SYSTEM PROMPT
// =====================================================

const SYSTEM_PROMPT = `
Bạn là AI tư vấn học thuật hỗ trợ tra cứu hội thảo và tạp chí khoa học.

QUY TẮC:
- Trả lời trực tiếp câu hỏi hiện tại bằng tiếng Việt.
- Với hội thảo/tạp chí, chỉ sử dụng dữ liệu hệ thống cung cấp.
- Không bịa tên, deadline, ngày tổ chức, quartile, nhà xuất bản, URL hoặc dữ liệu còn thiếu.
- Giữ nguyên tên chính thức của hội thảo/tạp chí.
- Dữ liệu N/A hoặc không có thì không tự bổ sung.
- Phân biệt deadline nộp bài với ngày diễn ra hội thảo.
- Kết quả đã được hệ thống truy xuất và xếp hạng trước.
- Không tự chào người dùng.
- Trả lời ngắn gọn, rõ ràng và có cấu trúc.
`.trim();


// =====================================================
// MAIN PROMPT BUILDER
// Giữ nguyên export/signature hiện tại.
// =====================================================

export function buildScholarPrompt(
  question,
  conferences = [],
  journals = [],
  llmContext = {}
) {
  const currentQuestion =
    normalizeText(question);

  const {
    history = [],
    profile = null,
    project = null,
    docs = []
  } = llmContext || {};

  const useHistory =
    needsHistory(currentQuestion);

  const useProfile =
    needsProfile(currentQuestion);

  const useProject =
    needsProject(currentQuestion);

  const useDocuments =
    needsDocuments(currentQuestion);

  const selectedContext = [
    useHistory && "history",
    useProfile && "profile",
    useProject && "project",
    useDocuments && "documents"
  ].filter(Boolean);

  console.log(
    "🧩 PROMPT CONTEXT:",
    selectedContext.join(", ") ||
    "retrieval-only"
  );

  const sections = [
    SYSTEM_PROMPT
  ];

  // Chỉ thêm context thực sự cần thiết.
  if (useProfile) {
    sections.push(
      buildProfileContext(profile)
    );
  }

  if (useProject) {
    sections.push(
      buildProjectContext(project)
    );
  }

  if (useDocuments) {
    sections.push(
      buildDocumentsContext(docs)
    );
  }

  if (useHistory) {
    sections.push(
      buildHistoryContext(history)
    );
  }

  // Retrieval luôn được ưu tiên.
  const conferenceContext =
    buildConferenceContext(conferences);

  const journalContext =
    buildJournalContext(journals);

  if (conferenceContext) {
    sections.push(conferenceContext);
  }

  if (journalContext) {
    sections.push(journalContext);
  }

  if (
    !conferenceContext &&
    !journalContext
  ) {
    sections.push(`
=== KẾT QUẢ TRA CỨU ===
Không có hội thảo hoặc tạp chí nào được hệ thống truy xuất cho câu hỏi hiện tại.

Nếu câu hỏi liên quan đến hồ sơ, dự án, tài liệu hoặc lịch sử đã được cung cấp, có thể trả lời dựa trên ngữ cảnh đó.

Nếu người dùng yêu cầu thông tin cụ thể về hội thảo hoặc tạp chí thì không được tự tạo kết quả.
`.trim());
  }

  sections.push(`
=== CÂU HỎI ===
${currentQuestion || "(empty)"}

=== YÊU CẦU ===
Trả lời trực tiếp câu hỏi trên.

Nếu liệt kê hội thảo:
- Chỉ sử dụng [C1], [C2], ... có trong dữ liệu.
- Giữ thứ tự kết quả hệ thống khi mức độ phù hợp tương đương.
- Nếu hỏi khả năng nộp bài, chú ý deadline và status.
- Không gọi hội thảo là "uy tín", "hàng đầu" hoặc tương tự nếu dữ liệu không có căn cứ cho nhận định đó.

Nếu liệt kê tạp chí:
- Chỉ sử dụng [J1], [J2], ... có trong dữ liệu.
- Không tự suy diễn quartile hoặc chỉ số còn thiếu.

Khi phù hợp, ghi mã [C1], [C2] hoặc [J1], [J2] sau tên để đối chiếu nguồn.
`.trim());

  return sections
    .filter(Boolean)
    .join("\n\n")
    .trim();
}