// agents/scholar/scholar.prompt.js

// =====================================================
// CONFIG
// =====================================================

const MAX_ITEMS = 5;

// Chỉ dùng một lượng history nhỏ khi câu hỏi thực sự
// là câu hỏi nối tiếp.
const MAX_HISTORY = 4;
const MAX_HISTORY_CHARS_PER_ITEM = 500;

// Project chỉ được đưa vào khi câu hỏi có liên quan.
const MAX_PROJECT_CHARS = 1500;

// Document chỉ được đưa vào khi câu hỏi có dấu hiệu
// yêu cầu sử dụng tài liệu.
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
  return normalizeText(value)
    .toLowerCase();
}


function truncate(value, maxChars) {
  const text = normalizeText(value);

  if (!text) {
    return "";
  }

  if (text.length <= maxChars) {
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
// =====================================================

/**
 * Không phải câu hỏi nào cũng cần:
 * - history
 * - profile
 * - project
 * - documents
 *
 * Retrieval question độc lập như:
 *
 * "Danh sách 5 hội thảo về AI"
 *
 * chỉ cần:
 * - current question
 * - retrieval results
 *
 * Điều này giúp prompt ngắn hơn đáng kể.
 */


function needsHistory(question) {
  const q =
    normalizeForDetection(question);

  if (!q) {
    return false;
  }

  const patterns = [
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
  ];

  return patterns.some(
    pattern => q.includes(pattern)
  );
}


function needsProfile(question) {
  const q =
    normalizeForDetection(question);

  if (!q) {
    return false;
  }

  const patterns = [
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
  ];

  return patterns.some(
    pattern => q.includes(pattern)
  );
}


function needsProject(question) {
  const q =
    normalizeForDetection(question);

  if (!q) {
    return false;
  }

  const patterns = [
    "dự án",
    "đề tài",
    "project",
    "nghiên cứu đang làm",
    "nghiên cứu của tôi",
    "đề tài của tôi",
    "dự án của tôi",
    "phù hợp với đề tài",
    "phù hợp với dự án"
  ];

  return patterns.some(
    pattern => q.includes(pattern)
  );
}


function needsDocuments(question) {
  const q =
    normalizeForDetection(question);

  if (!q) {
    return false;
  }

  const patterns = [
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
  ];

  return patterns.some(
    pattern => q.includes(pattern)
  );
}


// =====================================================
// DATE / STATUS HELPERS
// =====================================================

function safeTime(value) {
  if (!value) {
    return null;
  }

  const time =
    new Date(value).getTime();

  return Number.isFinite(time)
    ? time
    : null;
}


function getStatus(conference) {
  const now =
    Date.now();

  const deadline =
    safeTime(
      conference?.deadline
    );

  const start =
    safeTime(
      conference?.start_date
    );


  // ===================================================
  // DEADLINE AVAILABLE
  // ===================================================

  if (deadline !== null) {
    const diffDays =
      (deadline - now) /
      (1000 * 60 * 60 * 24);


    if (diffDays > 30) {
      return "submission_open";
    }


    if (diffDays > 0) {
      return "submission_soon";
    }


    // Deadline đã qua nhưng hội thảo chưa diễn ra.
    if (start !== null) {
      if (start > now) {
        return "upcoming_event";
      }

      return "past_event";
    }


    return "submission_closed";
  }


  // ===================================================
  // NO DEADLINE, BUT EVENT DATE AVAILABLE
  // ===================================================

  if (start !== null) {
    if (start > now) {
      return "upcoming_event";
    }

    return "past_event";
  }


  return "unknown";
}


// =====================================================
// PROFILE CONTEXT
// =====================================================

function buildProfileContext(profile) {
  if (!profile) {
    return "";
  }


  const lines = [];


  if (profile.full_name) {
    lines.push(
      `Họ tên: ${normalizeText(profile.full_name)}`
    );
  }


  if (profile.position) {
    lines.push(
      `Vị trí/Chức vụ: ${normalizeText(profile.position)}`
    );
  }


  if (profile.academic_title) {
    lines.push(
      `Chức danh khoa học: ${normalizeText(profile.academic_title)}`
    );
  }


  if (profile.academic_degree) {
    lines.push(
      `Học vị: ${normalizeText(profile.academic_degree)}`
    );
  }


  if (profile.department_name) {
    lines.push(
      `Đơn vị: ${normalizeText(profile.department_name)}`
    );
  }


  const directions =
    joinArray(
      profile.direction
    );


  if (directions) {
    lines.push(
      `Hướng nghiên cứu: ${directions}`
    );
  }


  if (!lines.length) {
    return "";
  }


  return [
    "=== HỒ SƠ NGƯỜI DÙNG ===",
    ...lines
  ].join("\n");
}


// =====================================================
// PROJECT CONTEXT
// =====================================================

function buildProjectContext(project) {
  if (!project) {
    return "";
  }


  const lines = [];


  const name =
    normalizeText(
      project?.name
    );


  const description =
    truncate(
      project?.description,
      MAX_PROJECT_CHARS
    );


  if (name) {
    lines.push(
      `Tên: ${name}`
    );
  }


  if (description) {
    lines.push(
      `Mô tả: ${description}`
    );
  }


  if (!lines.length) {
    return "";
  }


  return [
    "=== DỰ ÁN / ĐỀ TÀI ===",
    ...lines
  ].join("\n");
}


// =====================================================
// HISTORY CONTEXT
// =====================================================

function buildHistoryContext(history) {
  if (
    !Array.isArray(history) ||
    !history.length
  ) {
    return "";
  }


  const items =
    history
      .filter(
        item =>
          item &&
          ["user", "assistant"].includes(
            item.role
          ) &&
          typeof item.content === "string" &&
          item.content.trim()
      )
      .slice(-MAX_HISTORY)
      .map(item => {
        const role =
          item.role === "user"
            ? "User"
            : "Assistant";

        const content =
          truncate(
            item.content,
            MAX_HISTORY_CHARS_PER_ITEM
          );

        return `${role}: ${content}`;
      })
      .filter(Boolean);


  if (!items.length) {
    return "";
  }


  return [
    "=== HỘI THOẠI GẦN NHẤT ===",
    ...items
  ].join("\n");
}


// =====================================================
// DOCUMENT CONTEXT
// =====================================================

function buildDocumentsContext(docs) {
  if (
    !Array.isArray(docs) ||
    !docs.length
  ) {
    return "";
  }


  const lines = [
    "=== TÀI LIỆU NGƯỜI DÙNG ==="
  ];


  let remainingChars =
    MAX_DOC_CHARS;


  let truncatedAny =
    false;


  for (const doc of docs) {
    if (remainingChars <= 0) {
      truncatedAny = true;
      break;
    }


    const rawText =
      typeof doc?.text === "string"
        ? doc.text.trim()
        : "";


    if (!rawText) {
      continue;
    }


    const name =
      normalizeText(doc?.name) ||
      "document";


    const text =
      rawText.slice(
        0,
        remainingChars
      );


    if (
      text.length <
      rawText.length
    ) {
      truncatedAny = true;
    }


    remainingChars -=
      text.length;


    lines.push(
      `[FILE: ${name}]`
    );

    lines.push(
      text
    );
  }


  if (lines.length === 1) {
    return "";
  }


  if (truncatedAny) {
    lines.push(
      "[Một phần tài liệu đã được lược bớt do giới hạn ngữ cảnh.]"
    );
  }


  return lines.join("\n");
}


// =====================================================
// CONFERENCE DATA
// =====================================================

function buildConferenceContext(
  conferences
) {

  if (
    !Array.isArray(conferences) ||
    !conferences.length
  ) {
    return "";
  }


  const lines = [
    "=== HỘI THẢO TỪ HỆ THỐNG ==="
  ];


  conferences
    .slice(0, MAX_ITEMS)
    .forEach(
      (conference, index) => {

        const title =
          normalizeText(
            conference?.name ||
            conference?.title ||
            conference?.acronym
          ) ||
          "N/A";


        const location =
          [
            conference?.city,
            conference?.country
          ]
            .filter(Boolean)
            .map(normalizeText)
            .filter(Boolean)
            .join(", ") ||
          "N/A";


        const fields =
          joinArray(
            conference?.fields
          ) ||
          joinArray(
            conference?.topics
          ) ||
          "N/A";


        const url =
          normalizeText(
            conference?.cfp_link ||
            conference?.url ||
            conference?.link ||
            conference?.website
          ) ||
          "N/A";


        const deadline =
          normalizeText(
            conference?.deadline
          ) ||
          "N/A";


        const event =
          normalizeText(
            conference?.start_date
          ) ||
          "N/A";


        const status =
          getStatus(
            conference
          );


        lines.push(
          `[C${index + 1}] ` +
          `${title}` +
          ` | location: ${location}` +
          ` | deadline: ${deadline}` +
          ` | event: ${event}` +
          ` | status: ${status}` +
          ` | field: ${fields}` +
          ` | url: ${url}`
        );
      }
    );


  return lines.join("\n");
}


// =====================================================
// JOURNAL DATA
// =====================================================

function buildJournalContext(
  journals
) {

  if (
    !Array.isArray(journals) ||
    !journals.length
  ) {
    return "";
  }


  const lines = [
    "=== TẠP CHÍ TỪ HỆ THỐNG ==="
  ];


  journals
    .slice(0, MAX_ITEMS)
    .forEach(
      (journal, index) => {

        const title =
          normalizeText(
            journal?.title
          ) ||
          "N/A";


        const publisher =
          normalizeText(
            journal?.publisher
          ) ||
          "N/A";


        const quartile =
          normalizeText(
            journal?.sjr_best_quartile
          ) ||
          "N/A";


        const fields =
          joinArray(
            journal?.fields
          ) ||
          joinArray(
            journal?.categories
          ) ||
          joinArray(
            journal?.areas
          ) ||
          "N/A";


        const country =
          normalizeText(
            journal?.country
          ) ||
          "N/A";


        const url =
          normalizeText(
            journal?.scimago_link ||
            journal?.url
          ) ||
          "N/A";


        lines.push(
          `[J${index + 1}] ` +
          `${title}` +
          ` | publisher: ${publisher}` +
          ` | quartile: ${quartile}` +
          ` | field: ${fields}` +
          ` | country: ${country}` +
          ` | url: ${url}`
        );
      }
    );


  return lines.join("\n");
}


// =====================================================
// MAIN PROMPT BUILDER
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


  // ===================================================
  // DETERMINE REQUIRED CONTEXT
  // ===================================================

  const useHistory =
    needsHistory(currentQuestion);


  const useProfile =
    needsProfile(currentQuestion);


  const useProject =
    needsProject(currentQuestion);


  const useDocuments =
    needsDocuments(currentQuestion);


  // ===================================================
  // DEBUG CONTEXT SELECTION
  // ===================================================

  console.log(
    "🧩 PROMPT CONTEXT:",
    [
      useHistory
        ? "history"
        : null,

      useProfile
        ? "profile"
        : null,

      useProject
        ? "project"
        : null,

      useDocuments
        ? "documents"
        : null
    ]
      .filter(Boolean)
      .join(", ") ||
      "retrieval-only"
  );


  // ===================================================
  // SYSTEM INSTRUCTIONS
  // ===================================================

  const sections = [];


  sections.push(`
Bạn là AI tư vấn học thuật hỗ trợ tra cứu hội thảo và tạp chí khoa học.

QUY TẮC:
- Trả lời trực tiếp câu hỏi hiện tại bằng tiếng Việt.
- Với hội thảo/tạp chí, chỉ sử dụng dữ liệu hệ thống cung cấp bên dưới.
- Không bịa tên, deadline, ngày tổ chức, quartile, nhà xuất bản, URL hoặc dữ liệu còn thiếu.
- Giữ nguyên tên chính thức của hội thảo/tạp chí.
- Nếu dữ liệu là N/A hoặc không có thì không tự bổ sung.
- Phân biệt deadline nộp bài với ngày diễn ra hội thảo.
- Các kết quả đã được hệ thống truy xuất và xếp hạng trước.
- Không tự chào người dùng.
- Trả lời rõ ràng, ngắn gọn và có cấu trúc.
`.trim());


  // ===================================================
  // OPTIONAL CONTEXT
  // ===================================================

  if (useProfile) {
    const profileContext =
      buildProfileContext(
        profile
      );

    if (profileContext) {
      sections.push(
        profileContext
      );
    }
  }


  if (useProject) {
    const projectContext =
      buildProjectContext(
        project
      );

    if (projectContext) {
      sections.push(
        projectContext
      );
    }
  }


  if (useDocuments) {
    const documentsContext =
      buildDocumentsContext(
        docs
      );

    if (documentsContext) {
      sections.push(
        documentsContext
      );
    }
  }


  if (useHistory) {
    const historyContext =
      buildHistoryContext(
        history
      );

    if (historyContext) {
      sections.push(
        historyContext
      );
    }
  }


  // ===================================================
  // RETRIEVAL RESULTS
  // ===================================================

  const conferenceContext =
    buildConferenceContext(
      conferences
    );


  const journalContext =
    buildJournalContext(
      journals
    );


  if (conferenceContext) {
    sections.push(
      conferenceContext
    );
  }


  if (journalContext) {
    sections.push(
      journalContext
    );
  }


  // ===================================================
  // NO RETRIEVAL RESULTS
  // ===================================================

  if (
    !conferenceContext &&
    !journalContext
  ) {

    sections.push(`
=== KẾT QUẢ TRA CỨU ===
Không có hội thảo hoặc tạp chí nào được hệ thống truy xuất cho câu hỏi hiện tại.

Nếu câu hỏi liên quan đến hồ sơ, dự án, tài liệu hoặc lịch sử đã được cung cấp trong prompt, có thể trả lời dựa trên ngữ cảnh đó.

Nếu người dùng yêu cầu thông tin cụ thể về hội thảo hoặc tạp chí thì không được tự tạo kết quả.
`.trim());
  }


  // ===================================================
  // CURRENT QUESTION
  // ===================================================

  sections.push(`
=== CÂU HỎI ===
${currentQuestion || "(empty)"}

=== YÊU CẦU ===
Trả lời trực tiếp câu hỏi trên.

Nếu liệt kê hội thảo:
- Chỉ sử dụng [C1], [C2], ... có trong dữ liệu.
- Ưu tiên đúng thứ tự kết quả hệ thống khi mức độ phù hợp tương đương.
- Nếu người dùng hỏi khả năng nộp bài, chú ý deadline và status.
- Không gọi một hội thảo là "uy tín", "hàng đầu" hoặc tương tự nếu dữ liệu không cung cấp căn cứ cho nhận định đó.

Nếu liệt kê tạp chí:
- Chỉ sử dụng [J1], [J2], ... có trong dữ liệu.
- Không tự suy diễn quartile hoặc chỉ số còn thiếu.

Khi phù hợp, ghi mã [C1], [C2] hoặc [J1], [J2] sau tên để đối chiếu nguồn.
`.trim());


  // ===================================================
  // FINAL PROMPT
  // ===================================================

  return sections
    .filter(Boolean)
    .join("\n\n")
    .trim();
}