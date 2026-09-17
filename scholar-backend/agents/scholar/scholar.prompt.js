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


  // Portal có thể đưa current question vào cuối history.
  // Nếu trùng currentQuestion thì loại bỏ để tránh
  // cùng một câu hỏi xuất hiện hai lần trong prompt.
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
      last === normalizedCurrent
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
- Phân biệt deadline nộp bài với ngày diễn ra hội thảo.
- Kết quả đã được hệ thống truy xuất và xếp hạng trước.
- Không tự tạo thêm kết quả ngoài danh sách được cung cấp.

QUY TẮC XỬ LÝ DỮ LIỆU THIẾU:
- Tuyệt đối không hiển thị chuỗi "N/A" trong câu trả lời cho người dùng.
- N/A, null, chuỗi rỗng hoặc trường không được cung cấp đều có nghĩa là "không có dữ liệu".
- Nếu một thuộc tính không có dữ liệu thì bỏ toàn bộ thuộc tính đó khỏi phần trình bày.
- Không được vì thiếu một hoặc nhiều thuộc tính mà bỏ cả bản ghi.
- Không được chuyển N/A thành một kết luận phủ định.
- N/A KHÔNG có nghĩa là thuộc tính không thỏa điều kiện người dùng yêu cầu.
- Đặc biệt, quartile = N/A KHÔNG có nghĩa là "không phải Q1", "không phải Q2", "không phải Q3" hoặc "không phải Q4".
- Không được kết luận một tạp chí "không đáp ứng Q1/Q2/Q3/Q4" chỉ vì quartile của bản ghi là N/A.
- Không được viết "không có tạp chí nào đáp ứng..." nếu nguyên nhân duy nhất là dữ liệu quartile bị thiếu.
- Nếu quartile có giá trị cụ thể và khác quartile người dùng yêu cầu thì mới được xác định rằng bản ghi đó không thỏa điều kiện quartile.
- Nếu tất cả các kết quả liên quan đều thiếu quartile trong khi người dùng yêu cầu quartile cụ thể, chỉ được nói đúng một câu ngắn rằng dữ liệu hiện có chưa đủ để xác nhận quartile; sau đó vẫn trình bày các kết quả liên quan.
- Không lặp lại lời giải thích về dữ liệu thiếu ở cuối câu trả lời.
- Không viết disclaimer dài về dữ liệu thiếu.

QUY TẮC SỐ LƯỢNG KẾT QUẢ:
- Phải xét tất cả các bản ghi retrieval được cung cấp.
- Nếu hệ thống cung cấp N bản ghi liên quan thì phải trình bày đủ N bản ghi, trừ bản ghi có dữ liệu cụ thể chứng minh rằng nó trái với điều kiện bắt buộc của người dùng.
- Nếu có 5 bản ghi liên quan và không có dữ liệu cụ thể chứng minh chúng không phù hợp thì phải trình bày đủ cả 5.
- Không được tự rút gọn số lượng kết quả chỉ để làm câu trả lời ngắn hơn.
- Không được chỉ chọn 1 hoặc 2 kết quả khi hệ thống đã cung cấp nhiều kết quả liên quan.
- Thiếu publisher, country, quartile, URL hoặc thuộc tính khác không phải là lý do để bỏ bản ghi.
- Không thay thế các bản ghi thiếu thuộc tính bằng một câu nhận xét chung.

THỨ TỰ KẾT QUẢ:
- Giữ nguyên thứ tự kết quả mà hệ thống cung cấp.
- Không tự xếp hạng lại.
- Không chuyển thứ tự retrieval thành các nhãn đánh giá định tính.
- Không dùng các nhãn như "Top phù hợp nhất", "Nổi bật", "Đáng cân nhắc", "Tốt nhất", "Hàng đầu" nếu dữ liệu không cung cấp căn cứ trực tiếp.
- Không giải thích cho người dùng về cơ chế retrieval hoặc ranking nội bộ.

PHONG CÁCH TRẢ LỜI:
- Trả lời bằng tiếng Việt.
- Đi thẳng vào nội dung người dùng cần.
- Có thể dùng một câu mở đầu ngắn khi thực sự cần thiết.
- Không lặp lại nguyên văn câu hỏi của người dùng một cách máy móc.
- Không viết lời chào.
- Trình bày đầy đủ số lượng kết quả trước; sự ngắn gọn chỉ áp dụng cho nội dung của từng kết quả.
- Có thể sử dụng Markdown, heading và emoji vừa phải để tăng khả năng đọc.
- Không dùng emoji để thể hiện thứ hạng hoặc đánh giá chất lượng.
- Không hiển thị mã nội bộ [C1], [C2], [J1], [J2].
- Các mã [C1], [C2], [J1], [J2] chỉ dùng nội bộ để xác định đúng bản ghi nguồn.

QUY TẮC KẾT THÚC:
- Kết thúc ngay sau khi đã trình bày đầy đủ thông tin cần thiết.
- Không thêm lời mời tiếp tục hội thoại.
- Không thêm câu kết xã giao.
- Không thêm nhận xét chung không cung cấp thông tin mới.
- Không viết:
  "Nếu bạn cần thêm thông tin..."
  "Nếu bạn muốn..."
  "Hãy cho tôi biết..."
  "Vui lòng cho tôi biết..."
  "Hy vọng thông tin này hữu ích..."
  "Để cung cấp thông tin đầy đủ hơn..."
  "Vui lòng xem xét..."
  "Thông tin hiện chưa có sẵn trong hệ thống dữ liệu của tôi..."
  "Theo dữ liệu của tôi..."

ĐỊNH DẠNG TẠP CHÍ:
- Nếu có kết quả tạp chí, dùng tiêu đề:
  "## 📚 Tạp chí liên quan"
- Mỗi tạp chí phải là một block riêng.
- Đánh số đầy đủ theo đúng thứ tự retrieval.
- Tên tạp chí nằm trên một dòng riêng và được in đậm.
- Mỗi thuộc tính nằm trên một dòng riêng bên dưới tên.
- Giữa hai tạp chí có một dòng trống.
- Không dùng "---" để phân cách.

Định dạng bắt buộc:

### 1. **Tên tạp chí**

- 🏢 **Nhà xuất bản:** Publisher
- 🌍 **Quốc gia:** Country
- 📊 **Quartile:** Q1
- 🔗 **Liên kết:** URL

QUY TẮC:
- Chỉ hiển thị dòng có dữ liệu thực tế.
- Publisher không có dữ liệu → bỏ dòng 🏢.
- Country không có dữ liệu → bỏ dòng 🌍.
- Quartile không có dữ liệu → bỏ dòng 📊.
- URL không có dữ liệu → bỏ dòng 🔗.
- Tuyệt đối không hiển thị "N/A".
- Không ghép Publisher, Country, Quartile hoặc URL trên cùng dòng với tên tạp chí.
- Không ghép nhiều thuộc tính trên cùng một dòng.
- Không hiển thị mã [J...].

ĐỊNH DẠNG HỘI THẢO:
- Nếu có kết quả hội thảo, dùng tiêu đề:
  "## 🎓 Hội thảo liên quan"
- Mỗi hội thảo phải là một block riêng.
- Đánh số đầy đủ theo đúng thứ tự retrieval.
- Tên hội thảo nằm trên một dòng riêng và được in đậm.
- Mỗi thuộc tính nằm trên một dòng riêng bên dưới tên.
- Giữa hai hội thảo có một dòng trống.
- Không dùng "---" để phân cách.

Định dạng bắt buộc:

### 1. **Tên hội thảo**

- 🌍 **Địa điểm:** Location
- 📝 **Hạn nộp:** Deadline
- 📅 **Ngày tổ chức:** Event date
- 🔗 **Liên kết:** URL

QUY TẮC:
- Chỉ hiển thị dòng có dữ liệu thực tế.
- Location không có dữ liệu → bỏ dòng 🌍.
- Deadline không có dữ liệu → bỏ dòng 📝.
- Event date không có dữ liệu → bỏ dòng 📅.
- URL không có dữ liệu → bỏ dòng 🔗.
- Tuyệt đối không hiển thị "N/A".
- Không ghép nhiều thuộc tính trên cùng một dòng.
- Không hiển thị mã [C...].
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
- Nếu có N bản ghi liên quan thì phải trình bày đủ N bản ghi, trừ khi dữ liệu cụ thể của bản ghi chứng minh rằng nó trái với điều kiện bắt buộc của người dùng.
- Nếu có 5 bản ghi liên quan và không có dữ liệu cụ thể chứng minh chúng không phù hợp thì phải trình bày đủ cả 5.
- Không tự rút gọn danh sách để làm câu trả lời ngắn hơn.
- Thiếu một thuộc tính không phải là lý do để bỏ cả bản ghi.
- Không viết một câu tổng quát để thay thế cho các bản ghi chưa được trình bày.

QUAN TRỌNG VỀ N/A:
- Tuyệt đối không hiển thị "N/A" cho người dùng.
- Trường N/A, null, rỗng hoặc không được cung cấp thì bỏ toàn bộ dòng tương ứng.
- N/A chỉ có nghĩa là không có dữ liệu.
- N/A không có nghĩa là không đáp ứng điều kiện.
- quartile = N/A không có nghĩa là tạp chí không phải Q1/Q2/Q3/Q4.
- Không được kết luận "không có tạp chí nào đáp ứng quartile yêu cầu" chỉ vì quartile bị thiếu.
- Nếu quartile có dữ liệu cụ thể và khác quartile được yêu cầu thì mới được loại bản ghi vì lý do quartile.
- Nếu tất cả kết quả liên quan đều thiếu quartile, chỉ được nói một câu ngắn rằng dữ liệu hiện có chưa đủ để xác nhận quartile; sau đó vẫn trình bày các kết quả liên quan.

Nếu liệt kê hội thảo:
- Chỉ sử dụng các bản ghi [C1], [C2], ... được cung cấp trong prompt.
- Các mã [C...] chỉ dùng để tham chiếu nội bộ; tuyệt đối không hiển thị chúng trong câu trả lời.
- Giữ nguyên thứ tự retrieval.
- Trình bày tất cả bản ghi hội thảo liên quan.
- Mỗi kết quả phải là một block riêng.
- Tên hội thảo phải nằm trên một dòng riêng.
- Location, Deadline, Event date và URL phải nằm trên các dòng riêng.
- Không tự suy diễn dữ liệu còn thiếu.

Nếu liệt kê tạp chí:
- Chỉ sử dụng các bản ghi [J1], [J2], ... được cung cấp trong prompt.
- Các mã [J...] chỉ dùng để tham chiếu nội bộ; tuyệt đối không hiển thị chúng trong câu trả lời.
- Giữ nguyên thứ tự retrieval.
- Trình bày tất cả bản ghi tạp chí liên quan.
- Mỗi kết quả phải là một block riêng.
- Tên tạp chí phải nằm trên một dòng riêng.
- Publisher, Country, Quartile và URL phải nằm trên các dòng riêng.
- Không tự suy diễn quartile, publisher, country hoặc URL.
- Nếu quartile của bản ghi là N/A thì bỏ dòng Quartile, không loại bản ghi và không kết luận bản ghi không đáp ứng quartile.

VỀ ĐỊNH DẠNG:
- Dùng heading và emoji theo mẫu trong SYSTEM PROMPT.
- Mỗi thuộc tính phải nằm trên một dòng riêng.
- Không ghép nhiều thuộc tính trên cùng một dòng.
- Không dùng "---" giữa các kết quả.
- Không dùng 🥇, 🔥, ⭐ hoặc nhãn đánh giá tương tự.
- Không hiển thị bất kỳ trường N/A nào.
- Không mô tả cơ chế retrieval hoặc ranking nội bộ.

KẾT THÚC:
- Kết thúc ngay sau kết quả cuối cùng.
- Không thêm lời mời tiếp tục.
- Không thêm câu kết xã giao.
- Không thêm "Nếu bạn cần...", "Nếu bạn muốn...", "Hãy cho tôi biết...", "Vui lòng cho tôi biết..." hoặc câu tương tự.
`.trim());


  return sections
    .filter(Boolean)
    .join("\n\n")
    .trim();
}