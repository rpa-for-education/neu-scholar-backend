// agents/shared/queryRewriter.js

import { callLLMJson } from "./llm.js";


// =====================================================
// CONFIG
// =====================================================

const MAX_HISTORY = 6;
const MAX_HISTORY_CHARS_PER_ITEM = 700;


// =====================================================
// HELPERS
// =====================================================

function normalizeText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}


function truncate(value, maxChars) {
  const text = normalizeText(value);

  if (!text || text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars).trim()}…`;
}


function buildRecentHistory(history, question) {
  if (!Array.isArray(history) || !history.length) {
    return "";
  }

  const currentQuestion =
    normalizeText(question).toLowerCase();

  let items = history
    .filter(
      item =>
        item &&
        ["user", "assistant"].includes(item.role) &&
        typeof item.content === "string" &&
        item.content.trim()
    );


  // -----------------------------------------------------
  // Một số Portal có thể đưa current question
  // vào cuối history.
  //
  // Nếu trùng thì bỏ để tránh lặp.
  // -----------------------------------------------------

  if (
    items.length &&
    items[items.length - 1].role === "user"
  ) {
    const lastQuestion =
      normalizeText(
        items[items.length - 1].content
      ).toLowerCase();

    if (
      currentQuestion &&
      lastQuestion === currentQuestion
    ) {
      items = items.slice(0, -1);
    }
  }


  return items
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
    })
    .join("\n");
}


// =====================================================
// CONTEXTUAL QUERY REWRITE
// =====================================================

export async function rewriteQuery(
  question,
  history = []
) {
  const originalQuestion =
    normalizeText(question);

  if (!originalQuestion) {
    return "";
  }


  const recentHistory =
    buildRecentHistory(
      history,
      originalQuestion
    );


  const prompt = `
Bạn là bộ viết lại truy vấn cho hệ thống tra cứu học thuật.

NHIỆM VỤ:
Viết lại CÂU HỎI HIỆN TẠI thành MỘT truy vấn độc lập, đầy đủ ngữ cảnh,
để hệ thống có thể tìm kiếm chính xác dữ liệu học thuật.

Hệ thống hỗ trợ ba nhóm tài nguyên:

1. JOURNAL
   - tạp chí khoa học
   - quartile Q1, Q2, Q3, Q4
   - lĩnh vực/chủ đề
   - quốc gia
   - nhà xuất bản
   - các điều kiện liên quan đến tạp chí

2. CONFERENCE
   - hội thảo/hội nghị khoa học
   - lĩnh vực/chủ đề
   - quốc gia/địa điểm
   - deadline
   - thời gian tổ chức
   - các điều kiện liên quan đến hội thảo

3. FUND
   - quỹ tài trợ
   - cơ hội tài trợ nghiên cứu
   - agency/cơ quan tài trợ
   - quốc gia
   - lĩnh vực/chủ đề nghiên cứu
   - deadline
   - funding amount
   - applicant/đối tượng nộp
   - các điều kiện liên quan đến tài trợ


QUY TẮC NGỮ CẢNH:

- Nếu câu hỏi hiện tại đã đầy đủ và độc lập, giữ nguyên ý nghĩa của nó.

- Nếu câu hỏi hiện tại là câu hỏi tiếp nối, kế thừa những thông tin
  còn hiệu lực từ hội thoại trước.

- Phải giữ đúng loại tài nguyên đang được nói tới:
  journal, conference hoặc fund.

- Không tự chuyển loại tài nguyên nếu người dùng không yêu cầu.

- Điều kiện mới trong câu hỏi hiện tại thay thế điều kiện cũ cùng loại.

- Các điều kiện không bị thay đổi vẫn được kế thừa từ ngữ cảnh trước.

- Giữ lại chủ đề/lĩnh vực nghiên cứu nếu câu hỏi hiện tại không thay đổi chủ đề.

- Giữ lại quốc gia, nhà xuất bản, agency, quartile, deadline hoặc
  các điều kiện khác nếu chúng vẫn còn hiệu lực.

- Không tự thêm điều kiện hoặc thông tin không có trong câu hỏi
  hoặc lịch sử hội thoại.

- Không trả lời câu hỏi.

- Không giải thích.

- Chỉ viết lại thành MỘT truy vấn độc lập.


VÍ DỤ 1 — JOURNAL:

Lịch sử:
User: Cho tôi tạp chí Q1 về công nghệ giáo dục

Câu hiện tại:
Q2 thì sao?

Kết quả:
Cho tôi tạp chí Q2 về công nghệ giáo dục


VÍ DỤ 2 — JOURNAL:

Lịch sử:
User: Cho tôi tạp chí Q2 về công nghệ giáo dục

Câu hiện tại:
Ở Anh thì sao?

Kết quả:
Cho tôi tạp chí Q2 về công nghệ giáo dục ở Anh


VÍ DỤ 3 — CONFERENCE:

Lịch sử:
User: Tìm hội thảo về trí tuệ nhân tạo tại Singapore

Câu hiện tại:
Còn ở Nhật Bản?

Kết quả:
Tìm hội thảo về trí tuệ nhân tạo tại Nhật Bản


VÍ DỤ 4 — FUND:

Lịch sử:
User: Tìm quỹ tài trợ nghiên cứu AI tại Việt Nam

Câu hiện tại:
Còn của Mỹ?

Kết quả:
Tìm quỹ tài trợ nghiên cứu AI tại Mỹ


VÍ DỤ 5 — FUND:

Lịch sử:
User: Tìm quỹ tài trợ nghiên cứu AI tại Mỹ

Câu hiện tại:
Còn NASA?

Kết quả:
Tìm quỹ tài trợ nghiên cứu AI tại Mỹ của NASA


VÍ DỤ 6 — THAY ĐỔI LOẠI TÀI NGUYÊN:

Lịch sử:
User: Cho tôi tạp chí về công nghệ giáo dục

Câu hiện tại:
Có hội thảo tương tự không?

Kết quả:
Tìm hội thảo về công nghệ giáo dục


LỊCH SỬ HỘI THOẠI:
${recentHistory || "(không có)"}


CÂU HỎI HIỆN TẠI:
${originalQuestion}


Trả về đúng JSON:

{
  "query": "..."
}
`.trim();


  try {
    const data =
      await callLLMJson(prompt);


    if (
      data?.query &&
      typeof data.query === "string" &&
      data.query.trim()
    ) {
      const rewritten =
        normalizeText(data.query);


      console.log(
        "🔄 QUERY REWRITE:"
      );

      console.log(
        "   Original :",
        originalQuestion
      );

      console.log(
        "   Rewritten:",
        rewritten
      );


      return rewritten;
    }


    console.warn(
      "⚠️ QUERY REWRITE: invalid response, using original question."
    );

    return originalQuestion;

  } catch (error) {

    console.warn(
      "⚠️ QUERY REWRITE FALLBACK:",
      error?.message || error
    );

    return originalQuestion;
  }
}