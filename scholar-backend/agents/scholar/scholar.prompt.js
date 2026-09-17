// agents/scholar/scholar.prompt.js


// =====================================================
// CONFIG
// =====================================================

const MAX_ITEMS = 5;

const MAX_HISTORY = 6;
const MAX_HISTORY_CHARS_PER_ITEM = 700;

const MAX_PROFILE_CHARS = 2000;
const MAX_PROJECT_CHARS = 2500;
const MAX_DOC_CHARS = 5000;


// =====================================================
// TEXT UTILS
// =====================================================

function normalizeText(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}


function truncate(
  value,
  maxChars
) {
  const text =
    normalizeText(value);

  if (
    !text ||
    text.length <= maxChars
  ) {
    return text;
  }

  return `${text
    .slice(0, maxChars)
    .trim()}…`;
}


function joinArray(value) {
  if (Array.isArray(value)) {
    return value
      .filter(Boolean)
      .map(normalizeText)
      .filter(Boolean)
      .join(", ");
  }

  return normalizeText(value);
}


// =====================================================
// DATE / CONFERENCE STATUS
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
// USER PROFILE CONTEXT
// =====================================================

function buildProfileContext(
  profile
) {
  if (!profile) {
    return "";
  }


  const fields = [
    [
      "Họ tên",
      profile.full_name
    ],
    [
      "Vị trí/Chức vụ",
      profile.position
    ],
    [
      "Chức danh khoa học",
      profile.academic_title
    ],
    [
      "Học vị",
      profile.academic_degree
    ],
    [
      "Đơn vị",
      profile.department_name
    ],
    [
      "Hướng nghiên cứu",
      joinArray(
        profile.direction
      )
    ]
  ];


  const lines =
    fields
      .map(
        ([label, value]) => [
          label,
          normalizeText(value)
        ]
      )
      .filter(
        ([, value]) =>
          value
      )
      .map(
        ([label, value]) =>
          `${label}: ${value}`
      );


  if (!lines.length) {
    return "";
  }


  return truncate(
    [
      "=== HỒ SƠ NGƯỜI DÙNG ===",
      ...lines
    ].join("\n"),
    MAX_PROFILE_CHARS
  );
}


// =====================================================
// PROJECT CONTEXT
// =====================================================

function buildProjectContext(
  project
) {
  if (!project) {
    return "";
  }


  const name =
    normalizeText(
      project?.name
    );


  const description =
    truncate(
      project?.description,
      MAX_PROJECT_CHARS
    );


  const lines = [];


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
    "=== DỰ ÁN / ĐỀ TÀI HIỆN TẠI ===",
    ...lines
  ].join("\n");
}


// =====================================================
// CONVERSATION HISTORY
// =====================================================

function buildHistoryContext(
  history,
  currentQuestion = ""
) {
  if (
    !Array.isArray(history)
  ) {
    return "";
  }


  const normalizedCurrent =
    normalizeText(
      currentQuestion
    ).toLowerCase();


  let items =
    history.filter(
      item =>
        item &&
        [
          "user",
          "assistant"
        ].includes(
          item.role
        ) &&
        typeof item.content ===
          "string" &&
        item.content.trim()
    );


  // Portal có thể đưa câu hỏi hiện tại
  // vào cuối history.
  //
  // Nếu trùng currentQuestion thì loại bỏ
  // để tránh cùng câu hỏi xuất hiện hai lần.
  if (
    items.length &&
    items[
      items.length - 1
    ].role === "user"
  ) {
    const last =
      normalizeText(
        items[
          items.length - 1
        ].content
      ).toLowerCase();


    if (
      normalizedCurrent &&
      last ===
        normalizedCurrent
    ) {
      items =
        items.slice(
          0,
          -1
        );
    }
  }


  items =
    items
      .slice(
        -MAX_HISTORY
      )
      .map(
        item => {
          const role =
            item.role === "user"
              ? "User"
              : "Assistant";


          return `${role}: ${truncate(
            item.content,
            MAX_HISTORY_CHARS_PER_ITEM
          )}`;
        }
      );


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

function buildDocumentsContext(
  docs
) {
  if (
    !Array.isArray(docs) ||
    !docs.length
  ) {
    return "";
  }


  const lines = [
    "=== TÀI LIỆU NGƯỜI DÙNG ==="
  ];


  let remaining =
    MAX_DOC_CHARS;

  let truncated = false;


  for (const doc of docs) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }


    const raw =
      typeof doc?.text ===
        "string"
        ? doc.text.trim()
        : "";


    if (!raw) {
      continue;
    }


    const name =
      normalizeText(
        doc?.name
      ) ||
      "document";


    const text =
      raw.slice(
        0,
        remaining
      );


    if (
      text.length <
      raw.length
    ) {
      truncated = true;
    }


    remaining -=
      text.length;


    lines.push(
      `[FILE: ${name}]`,
      text
    );
  }


  if (
    lines.length === 1
  ) {
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
// CONFERENCE RETRIEVAL CONTEXT
// =====================================================

function buildConferenceContext(
  conferences
) {
  if (
    !Array.isArray(
      conferences
    ) ||
    !conferences.length
  ) {
    return "";
  }


  const items =
    conferences
      .slice(
        0,
        MAX_ITEMS
      )
      .map(
        (
          conference,
          index
        ) => {
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
              .map(
                normalizeText
              )
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


          const url =
            normalizeText(
              conference?.cfp_link ||
              conference?.url ||
              conference?.link ||
              conference?.website
            ) ||
            "N/A";


          return (
            `[C${index + 1}] ${title}` +
            ` | location: ${location}` +
            ` | deadline: ${deadline}` +
            ` | event: ${event}` +
            ` | status: ${getStatus(
              conference
            )}` +
            ` | field: ${fields}` +
            ` | url: ${url}`
          );
        }
      );


  return [
    "=== HỘI THẢO TỪ HỆ THỐNG ===",
    ...items
  ].join("\n");
}


// =====================================================
// JOURNAL RETRIEVAL CONTEXT
// =====================================================

function buildJournalContext(
  journals
) {
  if (
    !Array.isArray(
      journals
    ) ||
    !journals.length
  ) {
    return "";
  }


  const items =
    journals
      .slice(
        0,
        MAX_ITEMS
      )
      .map(
        (
          journal,
          index
        ) => {
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
              journal
                ?.sjr_best_quartile
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
              journal
                ?.scimago_link ||
              journal?.url
            ) ||
            "N/A";


          return (
            `[J${index + 1}] ${title}` +
            ` | publisher: ${publisher}` +
            ` | quartile: ${quartile}` +
            ` | field: ${fields}` +
            ` | country: ${country}` +
            ` | url: ${url}`
          );
        }
      );


  return [
    "=== TẠP CHÍ TỪ HỆ THỐNG ===",
    ...items
  ].join("\n");
}


// =====================================================
// SYSTEM PROMPT
// =====================================================

const SYSTEM_PROMPT = `
Bạn là AI tư vấn học thuật hỗ trợ người dùng tra cứu hội thảo và tạp chí khoa học.

MỤC TIÊU:
Trả lời chính xác, đầy đủ, trực tiếp và dễ đọc dựa trên dữ liệu mà hệ thống đã truy xuất.

NGỮ CẢNH HỘI THOẠI:
- Hiểu câu hỏi hiện tại trong ngữ cảnh của hội thoại trước.
- Nếu đây là câu hỏi tiếp nối, kế thừa các điều kiện còn hiệu lực từ hội thoại.
- Điều kiện mới thay thế điều kiện cũ cùng loại.
- Ví dụ: nếu trước đó người dùng hỏi tạp chí Q1 về công nghệ giáo dục rồi hỏi "Q2 thì sao?", phải hiểu là đang hỏi tạp chí Q2 về công nghệ giáo dục.
- Không tự chuyển giữa tạp chí và hội thảo nếu người dùng không yêu cầu.
- Hồ sơ, dự án, tài liệu và lịch sử hội thoại chỉ là ngữ cảnh hỗ trợ; không phải nguồn xác thực dữ liệu hội thảo hoặc tạp chí.

TÍNH CHÍNH XÁC:
- Với hội thảo và tạp chí, chỉ sử dụng dữ liệu trong phần kết quả truy xuất.
- Không bịa tên, quốc gia, nhà xuất bản, quartile, deadline, ngày tổ chức, URL, lĩnh vực hoặc bất kỳ dữ liệu nào không được cung cấp.
- Giữ nguyên tên chính thức của hội thảo và tạp chí.
- Không tự suy diễn dữ liệu từ tên tài nguyên.
- Giá trị N/A hoặc trường không có dữ liệu phải được coi là không có thông tin.
- Nếu một trường không có dữ liệu thì chỉ bỏ trường đó; không được vì thiếu một vài trường mà bỏ cả bản ghi.
- Không thông báo rằng trường đó "không có sẵn".
- Không viết disclaimer về dữ liệu bị thiếu.
- Phân biệt deadline nộp bài với ngày diễn ra hội thảo.
- Kết quả đã được hệ thống truy xuất và xếp hạng trước.
- Không tự tạo thêm kết quả ngoài danh sách được cung cấp.

QUY TẮC SỐ LƯỢNG KẾT QUẢ:
- Nếu phần kết quả truy xuất cung cấp N bản ghi phù hợp thì phải trình bày đủ N bản ghi.
- Nếu có 5 bản ghi hợp lệ thì phải trình bày đủ cả 5.
- Không được tự rút gọn số lượng kết quả chỉ để làm câu trả lời ngắn hơn.
- Không được chỉ chọn 1 hoặc 2 kết quả từ danh sách nếu hệ thống đã cung cấp nhiều kết quả phù hợp.
- Nếu một bản ghi thiếu publisher, country, URL hoặc trường khác thì chỉ bỏ trường bị thiếu; vẫn phải trình bày bản ghi đó.
- Không thay thế các bản ghi thiếu một số thuộc tính bằng một câu nhận xét chung.
- Chỉ loại một bản ghi khi chính dữ liệu của bản ghi cho thấy nó không thỏa điều kiện bắt buộc mà người dùng yêu cầu.
- Ví dụ: nếu người dùng yêu cầu Q4 và một bản ghi được cung cấp có quartile khác Q4 thì không trình bày bản ghi đó.
- Không tự suy diễn rằng bản ghi không phù hợp chỉ vì một thuộc tính là N/A.

THỨ TỰ KẾT QUẢ:
- Giữ nguyên thứ tự kết quả mà hệ thống cung cấp.
- Kết quả đầu tiên là kết quả được hệ thống xếp trước kết quả thứ hai, v.v.
- Không tự xếp hạng lại.
- Không chuyển thứ tự retrieval thành các nhãn đánh giá định tính.
- Không dùng các nhãn như "Top phù hợp nhất", "Nổi bật", "Đáng cân nhắc", "Tốt nhất", "Hàng đầu" nếu dữ liệu không cung cấp căn cứ trực tiếp.

PHONG CÁCH TRẢ LỜI:
- Trả lời bằng tiếng Việt.
- Đi thẳng vào nội dung người dùng cần.
- Có thể dùng một câu mở đầu ngắn để cho biết số lượng và loại kết quả.
- Không lặp lại nguyên văn câu hỏi của người dùng một cách máy móc.
- Không viết lời chào.
- Trình bày đầy đủ số lượng kết quả trước; sự ngắn gọn chỉ áp dụng cho nội dung của từng kết quả.
- Có thể sử dụng Markdown, heading và emoji vừa phải để tăng khả năng đọc.
- Không dùng emoji để thể hiện thứ hạng hoặc đánh giá chất lượng.
- Không viết đoạn kết xã giao hoặc đoạn kết không bổ sung thông tin.
- Không yêu cầu người dùng "xem xét các kết quả phía trên".
- Không dùng các câu như:
  "Để cung cấp thông tin đầy đủ hơn..."
  "Vui lòng xem xét..."
  "Hy vọng thông tin này hữu ích..."
  "Nếu bạn cần thêm thông tin..."
  "Thông tin hiện chưa có sẵn trong hệ thống dữ liệu của tôi..."
  "Dữ liệu của tôi..."
  "Theo dữ liệu của tôi..."
- Không tự nhận xét kết quả là "uy tín", "hàng đầu", "nổi bật", "đáng cân nhắc", "phù hợp nhất" hoặc tương tự nếu dữ liệu không cung cấp căn cứ.
- Không hiển thị mã nội bộ [C1], [C2], [J1], [J2] cho người dùng.
- Các mã [C1], [C2], [J1], [J2] chỉ dùng nội bộ để xác định đúng bản ghi nguồn.

ĐỊNH DẠNG TẠP CHÍ:
- Nếu có kết quả tạp chí, có thể dùng tiêu đề:
  "## 📚 Tạp chí liên quan"
- Đánh số đầy đủ các tạp chí theo đúng thứ tự retrieval.
- Tên tạp chí in đậm.
- Với mỗi tạp chí, chỉ hiển thị các trường có dữ liệu.
- Có thể sử dụng:
  🏢 Nhà xuất bản
  🌍 Quốc gia
  📊 Quartile
  🔗 Liên kết
- Không hiển thị một dòng nếu giá trị của trường đó là N/A.
- Không hiển thị mã [J...] trong tên hoặc nội dung.

ĐỊNH DẠNG HỘI THẢO:
- Nếu có kết quả hội thảo, có thể dùng tiêu đề:
  "## 🎓 Hội thảo liên quan"
- Đánh số đầy đủ các hội thảo theo đúng thứ tự retrieval.
- Tên hội thảo in đậm.
- Với mỗi hội thảo, chỉ hiển thị các trường có dữ liệu.
- Có thể sử dụng:
  🌍 Địa điểm
  📝 Deadline
  📅 Ngày tổ chức
  🔗 Liên kết
- Nếu câu hỏi liên quan khả năng nộp bài, có thể sử dụng status để diễn đạt trạng thái khi dữ liệu đủ rõ.
- Không hiển thị mã [C...] trong tên hoặc nội dung.
`.trim();


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
    normalizeText(
      question
    );


  const {
    history = [],
    profile = null,
    project = null,
    docs = []
  } =
    llmContext || {};


  // ===================================================
  // PORTAL CONTEXT
  // ===================================================

  const profileContext =
    buildProfileContext(
      profile
    );


  const projectContext =
    buildProjectContext(
      project
    );


  const documentsContext =
    buildDocumentsContext(
      docs
    );


  const historyContext =
    buildHistoryContext(
      history,
      currentQuestion
    );


  const selectedContext = [
    profileContext &&
      "profile",

    projectContext &&
      "project",

    documentsContext &&
      "documents",

    historyContext &&
      "history"
  ].filter(Boolean);


  console.log(
    "🧩 PROMPT CONTEXT:",
    selectedContext.join(", ") ||
      "retrieval-only"
  );


  const sections = [
    SYSTEM_PROMPT
  ];


  if (profileContext) {
    sections.push(
      profileContext
    );
  }


  if (projectContext) {
    sections.push(
      projectContext
    );
  }


  if (documentsContext) {
    sections.push(
      documentsContext
    );
  }


  if (historyContext) {
    sections.push(
      historyContext
    );
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


  if (
    !conferenceContext &&
    !journalContext
  ) {
    sections.push(`
=== KẾT QUẢ TRA CỨU ===
Không có hội thảo hoặc tạp chí nào được hệ thống truy xuất cho câu hỏi hiện tại.

Nếu câu hỏi có thể được trả lời trực tiếp từ hồ sơ, dự án, tài liệu hoặc lịch sử hội thoại đã cung cấp thì có thể sử dụng các ngữ cảnh đó.

Nếu người dùng đang yêu cầu hội thảo hoặc tạp chí cụ thể thì trả lời ngắn gọn rằng chưa tìm thấy kết quả phù hợp. Không tự tạo kết quả.
`.trim());
  }


  // ===================================================
  // CURRENT QUESTION + RESPONSE INSTRUCTION
  // ===================================================

  sections.push(`
=== CÂU HỎI HIỆN TẠI ===
${currentQuestion || "(empty)"}

=== YÊU CẦU TRẢ LỜI ===
Trả lời trực tiếp câu hỏi hiện tại dựa trên ngữ cảnh và kết quả truy xuất ở trên.

QUAN TRỌNG VỀ SỐ LƯỢNG:
- Phải xét tất cả các bản ghi retrieval được cung cấp.
- Nếu có N bản ghi hợp lệ với yêu cầu thì phải trình bày đủ N bản ghi.
- Không tự rút gọn danh sách để làm câu trả lời ngắn hơn.
- Thiếu một thuộc tính không phải là lý do để bỏ cả bản ghi.
- Nếu một trường là N/A thì chỉ bỏ trường đó.
- Không viết câu tổng quát để thay thế cho các bản ghi chưa được trình bày.

Nếu liệt kê hội thảo:
- Chỉ sử dụng các bản ghi [C1], [C2], ... được cung cấp trong prompt.
- Các mã [C...] chỉ dùng để tham chiếu nội bộ; tuyệt đối không hiển thị chúng trong câu trả lời.
- Giữ nguyên thứ tự kết quả hệ thống.
- Nếu người dùng hỏi khả năng nộp bài, sử dụng đúng deadline và status được cung cấp.
- Không gọi hội thảo là "uy tín", "hàng đầu", "nổi bật", "phù hợp nhất" hoặc tương tự nếu không có căn cứ trong dữ liệu.
- Trình bày tất cả bản ghi hội thảo hợp lệ, không chỉ một số bản ghi đầu.

Nếu liệt kê tạp chí:
- Chỉ sử dụng các bản ghi [J1], [J2], ... được cung cấp trong prompt.
- Các mã [J...] chỉ dùng để tham chiếu nội bộ; tuyệt đối không hiển thị chúng trong câu trả lời.
- Tôn trọng quartile và các điều kiện người dùng yêu cầu.
- Không tự suy diễn quartile, publisher, country hoặc thuộc tính còn thiếu.
- Nếu người dùng yêu cầu một quartile cụ thể, chỉ trình bày các bản ghi có dữ liệu xác nhận đúng quartile đó.
- Trình bày tất cả bản ghi tạp chí hợp lệ, không chỉ một số bản ghi đầu.

Về trình bày:
- Có thể dùng heading và emoji vừa phải để câu trả lời dễ đọc.
- Có thể dùng 📚 cho nhóm tạp chí, 🎓 cho nhóm hội thảo.
- Có thể dùng 🏢 cho nhà xuất bản, 🌍 cho quốc gia/địa điểm, 📊 cho quartile, 📝 cho deadline, 📅 cho ngày tổ chức và 🔗 cho liên kết.
- Không dùng 🥇, 🔥, ⭐ hoặc nhãn tương tự để tự đánh giá chất lượng hay mức độ phù hợp.
- Không hiển thị dòng có giá trị N/A.
- Không giải thích rằng dữ liệu bị thiếu.
- Không viết disclaimer về dữ liệu.

Sau khi đã trình bày đầy đủ các kết quả hợp lệ thì kết thúc câu trả lời.
Không thêm lời mời, lời kết xã giao hoặc nhận xét chung.
`.trim());


  return sections
    .filter(Boolean)
    .join("\n\n")
    .trim();
}