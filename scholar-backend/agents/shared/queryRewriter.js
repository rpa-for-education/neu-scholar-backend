// agents/shared/queryRewriter.js

import {
  callLLMJson
} from "./llm.js";


// =====================================================
// CONFIG
// =====================================================

/*
 * 6 messages ≈ 3 recent conversational turns.
 *
 * Query rewriting normally needs only the most recent
 * active search context. Keeping this small reduces
 * latency and prevents old constraints from leaking
 * into the current query.
 */
const MAX_HISTORY = 6;


/*
 * Assistant responses can be long.
 * 500 chars is normally enough for identifying:
 * - resource type
 * - topic
 * - country
 * - quartile
 * - agency
 * - deadline/year
 * - other active constraints
 */
const MAX_HISTORY_CHARS_PER_ITEM = 500;


// =====================================================
// TEXT HELPERS
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


function normalizeComparableText(value) {
  return normalizeText(value)
    .toLowerCase();
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


  return (
    `${text
      .slice(0, maxChars)
      .trim()}…`
  );
}


// =====================================================
// HISTORY
// =====================================================

function buildRecentHistory(
  history,
  question
) {
  if (
    !Array.isArray(history) ||
    !history.length
  ) {
    return "";
  }


  const currentQuestion =
    normalizeComparableText(
      question
    );


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


  // ---------------------------------------------------
  // REMOVE DUPLICATED CURRENT QUESTION
  //
  // Some Portal implementations append the current
  // user question to context.history before calling
  // Scholar/Fund.
  //
  // If so, remove exactly that final duplicated user
  // message.
  // ---------------------------------------------------

  if (
    items.length &&
    items[
      items.length - 1
    ].role === "user"
  ) {
    const lastQuestion =
      normalizeComparableText(
        items[
          items.length - 1
        ].content
      );


    if (
      currentQuestion &&
      lastQuestion ===
        currentQuestion
    ) {
      items =
        items.slice(
          0,
          -1
        );
    }
  }


  // ---------------------------------------------------
  // RECENT CONTEXT ONLY
  // ---------------------------------------------------

  return items
    .slice(
      -MAX_HISTORY
    )
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


      return (
        `${role}: ${content}`
      );
    })
    .join("\n");
}


// =====================================================
// PROMPT
// =====================================================

function buildRewritePrompt({
  originalQuestion,
  recentHistory
}) {
  return `
Bạn là bộ viết lại truy vấn cho hệ thống tra cứu học thuật.

NHIỆM VỤ:

Viết lại CÂU HỎI HIỆN TẠI thành MỘT truy vấn tìm kiếm độc lập,
ngắn gọn nhưng đầy đủ ngữ cảnh cần thiết để hệ thống truy xuất dữ liệu chính xác.

KHÔNG trả lời câu hỏi.
KHÔNG giải thích.
KHÔNG đề xuất tài nguyên.
KHÔNG tự bổ sung thông tin không có trong hội thoại.


=======================================================
CÁC LOẠI TÀI NGUYÊN
=======================================================

Hệ thống hỗ trợ ba loại tài nguyên:


1. JOURNAL — TẠP CHÍ

Có thể bao gồm:

- tên tạp chí
- lĩnh vực/chủ đề
- quartile Q1, Q2, Q3, Q4
- quốc gia
- khu vực
- nhà xuất bản
- ISSN
- SJR
- H-index
- open access
- các điều kiện liên quan đến tạp chí


2. CONFERENCE — HỘI THẢO/HỘI NGHỊ

Có thể bao gồm:

- tên hội thảo
- acronym
- lĩnh vực/chủ đề
- quốc gia
- thành phố/địa điểm
- deadline
- thời gian tổ chức
- trạng thái
- các điều kiện liên quan đến hội thảo


3. FUND — QUỸ/CƠ HỘI TÀI TRỢ

Có thể bao gồm:

- tên cơ hội tài trợ
- agency/cơ quan tài trợ
- quốc gia
- lĩnh vực/chủ đề nghiên cứu
- deadline
- năm
- funding amount
- award ceiling/floor
- funding instrument
- applicant/đối tượng đủ điều kiện
- trạng thái cơ hội tài trợ
- các điều kiện liên quan đến tài trợ


=======================================================
NGUYÊN TẮC CHUNG
=======================================================

1. Nếu câu hỏi hiện tại đã đầy đủ và độc lập:
   - giữ nguyên ý nghĩa;
   - chỉ chuẩn hóa thành truy vấn tìm kiếm rõ ràng nếu cần.

2. Nếu câu hỏi hiện tại là câu hỏi tiếp nối:
   - sử dụng lịch sử để khôi phục những thông tin còn hiệu lực;
   - tạo thành một truy vấn có thể hiểu được mà không cần đọc lịch sử.

3. Không tự thêm:
   - chủ đề;
   - quốc gia;
   - quartile;
   - agency;
   - năm;
   - deadline;
   - publisher;
   - hoặc bất kỳ điều kiện nào
   nếu thông tin đó không xuất hiện hoặc không được suy ra trực tiếp
   từ yêu cầu của người dùng trong hội thoại.

4. Ưu tiên ý định trong CÂU HỎI HIỆN TẠI hơn lịch sử.

5. Thông tin mới cùng loại thay thế thông tin cũ.

Ví dụ:

Q1 → Q2

Singapore → Nhật Bản

Việt Nam → Mỹ

2026 → 2027

NSF → NASA

6. Những điều kiện không bị thay đổi vẫn được kế thừa.

7. Nếu người dùng yêu cầu bỏ một điều kiện:
   - phải loại bỏ điều kiện đó khỏi truy vấn mới.

Ví dụ:

Lịch sử:
User: Tìm tạp chí Q1 về AI ở Mỹ

Câu hiện tại:
Bỏ điều kiện quốc gia

Kết quả:
Tìm tạp chí Q1 về AI


=======================================================
QUY TẮC VỀ LOẠI TÀI NGUYÊN
=======================================================

8. Nếu người dùng đang nói về một loại tài nguyên và
   câu hiện tại không yêu cầu đổi loại:
   - giữ nguyên loại tài nguyên đó.

9. Không tự chuyển:

journal ↔ conference ↔ fund

10. Chỉ chuyển loại tài nguyên khi câu hiện tại thể hiện rõ
    người dùng muốn loại tài nguyên khác.

Ví dụ:

Lịch sử:
User: Cho tôi tạp chí về công nghệ giáo dục

Câu hiện tại:
Có hội thảo tương tự không?

Kết quả:
Tìm hội thảo về công nghệ giáo dục


=======================================================
QUY TẮC KẾ THỪA CHỦ ĐỀ
=======================================================

11. Nếu câu hiện tại chỉ thay đổi một điều kiện như:

- quartile
- quốc gia
- địa điểm
- agency
- publisher
- deadline
- năm

thì giữ lại chủ đề/lĩnh vực nghiên cứu đang được nói tới.

Ví dụ:

Lịch sử:
User: Tìm hội thảo về trí tuệ nhân tạo tại Singapore

Câu hiện tại:
Còn Nhật Bản?

Kết quả:
Tìm hội thảo về trí tuệ nhân tạo tại Nhật Bản


=======================================================
QUY TẮC VỀ LỊCH SỬ
=======================================================

12. Tin nhắn USER là nguồn chính để xác định yêu cầu và điều kiện.

13. Tin nhắn ASSISTANT chỉ được sử dụng để hiểu mạch hội thoại,
    tham chiếu hoặc đối tượng mà người dùng đang nhắc tới.

14. Không biến một thông tin do ASSISTANT tự đề xuất hoặc tự suy diễn
    thành điều kiện tìm kiếm mới nếu USER chưa yêu cầu điều đó.

15. Ưu tiên các lượt hội thoại gần nhất.

16. Không khôi phục một điều kiện cũ nếu người dùng đã thay thế
    hoặc loại bỏ điều kiện đó ở lượt sau.


=======================================================
VÍ DỤ
=======================================================

VÍ DỤ 1 — JOURNAL / THAY QUARTILE

Lịch sử:
User: Cho tôi tạp chí Q1 về công nghệ giáo dục

Câu hiện tại:
Q2 thì sao?

Kết quả:
Cho tôi tạp chí Q2 về công nghệ giáo dục


VÍ DỤ 2 — JOURNAL / THAY QUỐC GIA

Lịch sử:
User: Cho tôi tạp chí Q2 về công nghệ giáo dục

Câu hiện tại:
Ở Anh thì sao?

Kết quả:
Cho tôi tạp chí Q2 về công nghệ giáo dục ở Anh


VÍ DỤ 3 — JOURNAL / THAY QUARTILE, GIỮ CÁC ĐIỀU KIỆN KHÁC

Lịch sử:
User: Tìm tạp chí Q1 về trí tuệ nhân tạo ở Mỹ

Câu hiện tại:
Còn Q2?

Kết quả:
Tìm tạp chí Q2 về trí tuệ nhân tạo ở Mỹ


VÍ DỤ 4 — CONFERENCE / THAY QUỐC GIA

Lịch sử:
User: Tìm hội thảo về trí tuệ nhân tạo tại Singapore

Câu hiện tại:
Còn ở Nhật Bản?

Kết quả:
Tìm hội thảo về trí tuệ nhân tạo tại Nhật Bản


VÍ DỤ 5 — CONFERENCE / THAY CHỦ ĐỀ

Lịch sử:
User: Tìm hội thảo về trí tuệ nhân tạo tại Nhật Bản

Câu hiện tại:
Còn về công nghệ giáo dục?

Kết quả:
Tìm hội thảo về công nghệ giáo dục tại Nhật Bản


VÍ DỤ 6 — FUND / THAY QUỐC GIA

Lịch sử:
User: Tìm quỹ tài trợ nghiên cứu AI tại Việt Nam

Câu hiện tại:
Còn của Mỹ?

Kết quả:
Tìm quỹ tài trợ nghiên cứu AI tại Mỹ


VÍ DỤ 7 — FUND / THAY AGENCY

Lịch sử:
User: Tìm quỹ tài trợ nghiên cứu AI tại Mỹ của NSF

Câu hiện tại:
Còn NASA?

Kết quả:
Tìm quỹ tài trợ nghiên cứu AI tại Mỹ của NASA


VÍ DỤ 8 — FUND / THAY NĂM

Lịch sử:
User: Tìm quỹ tài trợ nghiên cứu AI tại Mỹ năm 2026

Câu hiện tại:
Còn năm 2027?

Kết quả:
Tìm quỹ tài trợ nghiên cứu AI tại Mỹ năm 2027


VÍ DỤ 9 — CHUYỂN JOURNAL → CONFERENCE

Lịch sử:
User: Cho tôi tạp chí về công nghệ giáo dục

Câu hiện tại:
Có hội thảo tương tự không?

Kết quả:
Tìm hội thảo về công nghệ giáo dục


VÍ DỤ 10 — CHUYỂN CONFERENCE → FUND

Lịch sử:
User: Tìm hội thảo về AI

Câu hiện tại:
Có quỹ tài trợ nào cho chủ đề này không?

Kết quả:
Tìm quỹ tài trợ nghiên cứu về AI


=======================================================
DỮ LIỆU HỘI THOẠI
=======================================================

LỊCH SỬ GẦN ĐÂY:

${recentHistory || "(không có)"}


CÂU HỎI HIỆN TẠI:

${originalQuestion}


=======================================================
OUTPUT
=======================================================

Chỉ trả về JSON hợp lệ theo đúng cấu trúc:

{
  "query": "..."
}

Không thêm Markdown.
Không thêm giải thích.
Không thêm bất kỳ trường JSON nào khác.
`.trim();
}


// =====================================================
// CONTEXTUAL QUERY REWRITE
// =====================================================

export async function rewriteQuery(
  question,
  history = []
) {
  const originalQuestion =
    normalizeText(
      question
    );


  if (!originalQuestion) {
    return "";
  }


  const recentHistory =
    buildRecentHistory(
      history,
      originalQuestion
    );


  const prompt =
    buildRewritePrompt({
      originalQuestion,
      recentHistory
    });


  try {
    const data =
      await callLLMJson(
        prompt
      );


    if (
      data &&
      typeof data === "object" &&
      typeof data.query ===
        "string" &&
      data.query.trim()
    ) {
      const rewritten =
        normalizeText(
          data.query
        );


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
      error?.message ||
      error
    );


    /*
     * Query rewrite failure must never break
     * Scholar/Fund retrieval.
     */
    return originalQuestion;
  }
}