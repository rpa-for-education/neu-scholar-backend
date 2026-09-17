// agents/scholar/scholar.prompt.js

export function buildScholarPrompt(
  question,
  conferences = [],
  journals = [],
  llmContext = {}
) {

  // =====================================================
  // LIMITS
  // =====================================================

  const MAX_HISTORY = 10;

  // Giới hạn mỗi message trong history
  const MAX_HISTORY_CHARS_PER_ITEM = 2000;

  // Tối đa số conference / journal đưa vào LLM
  const MAX_ITEMS = 5;

  // Qwen2.5 hiện dùng context 16K.
  // Không đưa toàn bộ file dài vào prompt.
  const MAX_DOC_CHARS = 12000;

  // Giới hạn mô tả project để tránh context bất thường
  const MAX_PROJECT_CHARS = 4000;


  // =====================================================
  // CONTEXT
  // =====================================================

  const {
    history = [],
    profile = null,
    project = null,
    docs = []
  } = llmContext || {};


  let context = `
Bạn là AI tư vấn học thuật hỗ trợ tra cứu hội thảo và tạp chí khoa học.

QUY TẮC:
- Trả lời đúng câu hỏi hiện tại của người dùng.
- Đối với thông tin về hội thảo và tạp chí, chỉ sử dụng dữ liệu hội thảo và tạp chí được cung cấp bên dưới.
- Không được bịa tên hội thảo, tạp chí, hạn nộp bài, ngày tổ chức, quartile, nhà xuất bản hoặc thông tin học thuật.
- Không được tự tạo hội thảo hoặc tạp chí không xuất hiện trong dữ liệu được cung cấp.
- Có thể sử dụng hồ sơ người dùng để cá nhân hóa câu trả lời khi thực sự phù hợp.
- Có thể sử dụng thông tin dự án/đề tài khi câu hỏi liên quan đến dự án đó.
- Có thể sử dụng nội dung tài liệu người dùng cung cấp để hiểu chủ đề, nội dung và bối cảnh nghiên cứu.
- Sử dụng lịch sử hội thoại để hiểu các câu hỏi nối tiếp và tham chiếu như "ở trên", "trong số đó", "cái nào", "hội thảo đó" hoặc "tạp chí đó".
- Câu hỏi hiện tại có mức ưu tiên cao nhất.
- Nếu hồ sơ, dự án, tài liệu hoặc lịch sử không liên quan đến câu hỏi hiện tại thì bỏ qua.
- Các kết quả hội thảo và tạp chí đã được hệ thống tìm kiếm và xếp hạng trước khi đưa vào đây; ưu tiên các kết quả ở đầu danh sách khi mức độ phù hợp tương đương.
- Khi người dùng hỏi về hội thảo phù hợp để nộp bài, ưu tiên hội thảo còn hạn nộp bài nếu dữ liệu cho phép xác định.
- Phân biệt rõ hạn nộp bài (deadline) với ngày diễn ra hội thảo (event date).
- Không suy diễn dữ liệu còn thiếu.
- Nếu một thuộc tính được ghi là N/A thì không được tự bổ sung giá trị.
- Nếu dữ liệu được cung cấp không đủ để khẳng định điều gì, hãy nói rõ giới hạn đó.
- Không tự chào người dùng; lời chào đầu phiên được hệ thống xử lý riêng.
- Trả lời bằng tiếng Việt, rõ ràng, súc tích và có cấu trúc phù hợp với câu hỏi.
`.trim();


  // =====================================================
  // USER PROFILE
  // =====================================================

  if (profile) {

    const directions =
      Array.isArray(profile.direction)
        ? profile.direction
            .filter(Boolean)
            .map(String)
            .join(", ")
        : "";


    const hasProfileData =
      profile.full_name ||
      profile.position ||
      profile.academic_title ||
      profile.academic_degree ||
      profile.department_name ||
      directions;


    if (hasProfileData) {

      context +=
        "\n\n=== HỒ SƠ NGƯỜI DÙNG ===\n";


      if (profile.full_name) {
        context +=
          `Họ tên: ${profile.full_name}\n`;
      }


      if (profile.position) {
        context +=
          `Vị trí/Chức vụ: ${profile.position}\n`;
      }


      if (profile.academic_title) {
        context +=
          `Chức danh khoa học: ${profile.academic_title}\n`;
      }


      if (profile.academic_degree) {
        context +=
          `Học vị: ${profile.academic_degree}\n`;
      }


      if (profile.department_name) {
        context +=
          `Đơn vị: ${profile.department_name}\n`;
      }


      if (directions) {
        context +=
          `Hướng nghiên cứu: ${directions}\n`;
      }
    }
  }


  // =====================================================
  // PROJECT
  // =====================================================

  if (project) {

    const projectName =
      typeof project.name === "string"
        ? project.name.trim()
        : "";


    const projectDescription =
      typeof project.description === "string"
        ? project.description
            .trim()
            .slice(0, MAX_PROJECT_CHARS)
        : "";


    if (
      projectName ||
      projectDescription
    ) {

      context +=
        "\n=== DỰ ÁN / ĐỀ TÀI ĐANG MỞ ===\n";


      if (projectName) {
        context +=
          `Tên: ${projectName}\n`;
      }


      if (projectDescription) {
        context +=
          `Mô tả: ${projectDescription}\n`;
      }
    }
  }


  // =====================================================
  // DOCUMENTS
  // =====================================================

  if (
    Array.isArray(docs) &&
    docs.length
  ) {

    context +=
      "\n=== TÀI LIỆU NGƯỜI DÙNG CUNG CẤP ===\n";


    let remainingChars =
      MAX_DOC_CHARS;


    let truncated =
      false;


    for (const doc of docs) {

      if (remainingChars <= 0) {
        truncated = true;
        break;
      }


      const rawText =
        typeof doc?.text === "string"
          ? doc.text.trim()
          : "";


      if (!rawText) {
        continue;
      }


      const docName =
        typeof doc?.name === "string" &&
        doc.name.trim()
          ? doc.name.trim()
          : "document";


      const text =
        rawText.slice(
          0,
          remainingChars
        );


      if (
        text.length <
        rawText.length
      ) {
        truncated = true;
      }


      remainingChars -=
        text.length;


      context +=
        `\n[FILE: ${docName}]\n`;

      context +=
        `${text}\n`;
    }


    if (truncated) {
      context +=
        "\n[Ghi chú: Một phần nội dung tài liệu đã được lược bớt do giới hạn ngữ cảnh. Không suy diễn nội dung nằm ngoài phần được cung cấp.]\n";
    }
  }


  // =====================================================
  // HISTORY
  // =====================================================

  if (
    Array.isArray(history) &&
    history.length
  ) {

    context +=
      "\n=== LỊCH SỬ HỘI THOẠI GẦN NHẤT ===\n";


    history
      .filter(
        h =>
          h &&
          ["user", "assistant"].includes(
            h.role
          ) &&
          typeof h.content === "string" &&
          h.content.trim()
      )
      .slice(-MAX_HISTORY)
      .forEach(h => {

        const role =
          h.role === "user"
            ? "User"
            : "Assistant";


        const content =
          h.content
            .trim()
            .slice(
              0,
              MAX_HISTORY_CHARS_PER_ITEM
            );


        context +=
          `${role}: ${content}\n`;
      });
  }


  // =====================================================
  // STATUS HELPER
  // =====================================================

  function safeTime(value) {

    if (!value) {
      return null;
    }


    const time =
      new Date(value)
        .getTime();


    return Number.isFinite(time)
      ? time
      : null;
  }


  function getStatus(c) {

    const now =
      Date.now();


    const deadline =
      safeTime(c?.deadline);


    const start =
      safeTime(c?.start_date);


    // -------------------------------------------------
    // Có deadline
    // -------------------------------------------------

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


      // Deadline đã qua
      if (start !== null) {

        if (start > now) {
          return "upcoming_event";
        }


        return "past_event";
      }


      return "submission_closed";
    }


    // -------------------------------------------------
    // Không có deadline nhưng có event date
    // -------------------------------------------------

    if (start !== null) {

      if (start > now) {
        return "upcoming_event";
      }


      return "past_event";
    }


    return "unknown";
  }


  // =====================================================
  // CONFERENCES
  // =====================================================

  if (
    Array.isArray(conferences) &&
    conferences.length
  ) {

    context +=
      "\n=== DỮ LIỆU HỘI THẢO TỪ HỆ THỐNG ===\n";


    conferences
      .slice(0, MAX_ITEMS)
      .forEach(
        (c, i) => {

          const title =
            c?.name ||
            c?.title ||
            c?.acronym ||
            "N/A";


          const location =
            [
              c?.city,
              c?.country
            ]
              .filter(Boolean)
              .join(", ") ||
            "N/A";


          const fields =
            Array.isArray(c?.fields) &&
            c.fields.length
              ? c.fields
                  .filter(Boolean)
                  .join(", ")

              : Array.isArray(c?.topics) &&
                c.topics.length
                ? c.topics
                    .filter(Boolean)
                    .join(", ")

                : "N/A";


          const url =
            c?.cfp_link ||
            c?.url ||
            c?.link ||
            c?.website ||
            "N/A";


          context +=
            `[C${i + 1}] ` +
            `${title}` +
            ` | location: ${location}` +
            ` | deadline: ${c?.deadline || "N/A"}` +
            ` | event: ${c?.start_date || "N/A"}` +
            ` | status: ${getStatus(c)}` +
            ` | field: ${fields}` +
            ` | url: ${url}\n`;
        }
      );
  }


  // =====================================================
  // JOURNALS
  // =====================================================

  if (
    Array.isArray(journals) &&
    journals.length
  ) {

    context +=
      "\n=== DỮ LIỆU TẠP CHÍ TỪ HỆ THỐNG ===\n";


    journals
      .slice(0, MAX_ITEMS)
      .forEach(
        (j, i) => {

          const fields =
            Array.isArray(j?.fields) &&
            j.fields.length
              ? j.fields
                  .filter(Boolean)
                  .join(", ")

              : Array.isArray(j?.categories) &&
                j.categories.length
                ? j.categories
                    .filter(Boolean)
                    .join(", ")

                : Array.isArray(j?.areas) &&
                  j.areas.length
                  ? j.areas
                      .filter(Boolean)
                      .join(", ")

                  : "N/A";


          const url =
            j?.scimago_link ||
            j?.url ||
            "N/A";


          context +=
            `[J${i + 1}] ` +
            `${j?.title || "N/A"}` +
            ` | publisher: ${j?.publisher || "N/A"}` +
            ` | quartile: ${j?.sjr_best_quartile || "N/A"}` +
            ` | field: ${fields}` +
            ` | country: ${j?.country || "N/A"}` +
            ` | url: ${url}\n`;
        }
      );
  }


  // =====================================================
  // NO RETRIEVAL RESULTS
  // =====================================================

  if (
    (!Array.isArray(conferences) ||
      conferences.length === 0) &&
    (!Array.isArray(journals) ||
      journals.length === 0)
  ) {

    context += `
    
=== KẾT QUẢ TRA CỨU HỌC THUẬT ===
Không có hội thảo hoặc tạp chí nào được hệ thống truy xuất cho câu hỏi hiện tại.

Nếu câu hỏi chỉ liên quan đến tài liệu, hồ sơ, dự án hoặc lịch sử hội thoại thì vẫn trả lời dựa trên ngữ cảnh tương ứng.

Nếu câu hỏi yêu cầu thông tin cụ thể về hội thảo hoặc tạp chí thì không được tự tạo kết quả.
`;
  }


  // =====================================================
  // CURRENT QUESTION
  // =====================================================

  context += `

=== CÂU HỎI HIỆN TẠI ===
${typeof question === "string"
  ? question.trim()
  : String(question || "")}

=== YÊU CẦU TRẢ LỜI ===
Hãy trả lời trực tiếp câu hỏi hiện tại bằng tiếng Việt.

Nếu liệt kê hội thảo hoặc tạp chí:
- Chỉ liệt kê các mục có trong dữ liệu hệ thống ở trên.
- Giữ nguyên tên chính thức.
- Không tự tạo deadline, quartile hoặc thông tin còn thiếu.
- Khi phù hợp, sử dụng mã [C1], [C2], ... hoặc [J1], [J2], ... để người dùng có thể đối chiếu với nguồn.
`;


  return context.trim();
}