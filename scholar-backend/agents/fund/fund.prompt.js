// agents/fund/fund.prompt.js

// =====================================================
// CONFIG
// =====================================================

const MAX_FUNDS = 5;

const MAX_HISTORY = 6;
const MAX_HISTORY_CHARS = 700;

const MAX_SUMMARY_CHARS = 300;


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


function truncate(value, maxChars) {
  const text = normalizeText(value);

  if (!text || text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars).trim()}…`;
}


// =====================================================
// FUND FIELD HELPERS
// =====================================================

function getTitle(fund) {
  return normalizeText(
    fund?.opportunity_title ||
    fund?.title
  );
}


function getAgency(fund) {
  return normalizeText(
    fund?.agency_name ||
    fund?.agency
  );
}


function getDeadline(fund) {
  return normalizeText(
    fund?.close_date ||
    fund?.deadline
  );
}


function getAmount(fund) {
  return normalizeText(
    fund?.funding_amount ??
    fund?.amount
  );
}


function getLink(fund) {
  return normalizeText(
    fund?.url ||
    fund?.link ||
    fund?.additional_info_url ||
    fund?.["LINK TO ADDITIONAL INFORMATION"] ||
    fund?.["OPPORTUNITY URL"]
  );
}


function getSummary(fund) {
  return truncate(
    fund?.description ||
    fund?.text,
    MAX_SUMMARY_CHARS
  );
}


// =====================================================
// HISTORY
// =====================================================

function buildHistoryContext(
  history,
  currentQuestion
) {
  if (
    !Array.isArray(history) ||
    !history.length
  ) {
    return "";
  }


  let items = history
    .filter(
      item =>
        item &&
        ["user", "assistant"].includes(item.role) &&
        typeof item.content === "string" &&
        item.content.trim()
    );


  // -----------------------------------------------------
  // Portal đôi khi có thể đưa current question
  // vào cuối history.
  //
  // Nếu trùng với câu hỏi hiện tại thì loại bỏ để
  // tránh prompt chứa cùng một câu hỏi hai lần.
  // -----------------------------------------------------

  if (
    items.length &&
    items[items.length - 1].role === "user"
  ) {
    const lastQuestion =
      normalizeText(
        items[items.length - 1].content
      ).toLowerCase();

    const current =
      normalizeText(
        currentQuestion
      ).toLowerCase();

    if (
      current &&
      lastQuestion === current
    ) {
      items =
        items.slice(0, -1);
    }
  }


  items = items
    .slice(-MAX_HISTORY)
    .map(item => {
      const role =
        item.role === "user"
          ? "User"
          : "Assistant";

      return (
        `${role}: ` +
        truncate(
          item.content,
          MAX_HISTORY_CHARS
        )
      );
    });


  if (!items.length) {
    return "";
  }


  return [
    "=== CONVERSATION HISTORY ===",
    ...items
  ].join("\n");
}


// =====================================================
// FUNDS CONTEXT
// =====================================================

function buildFundsContext(funds) {
  if (
    !Array.isArray(funds) ||
    !funds.length
  ) {
    return "";
  }


  const items =
    funds
      .slice(0, MAX_FUNDS)
      .map((fund, index) => {

        const id =
          `F${index + 1}`;


        const fields = [
          `[${id}]`,
          `Title: ${getTitle(fund) || "N/A"}`,
          `Agency: ${getAgency(fund) || "N/A"}`,
          `Deadline: ${getDeadline(fund) || "N/A"}`,
          `Funding: ${getAmount(fund) || "N/A"}`,
          `Link: ${getLink(fund) || "N/A"}`,
          `Summary: ${getSummary(fund) || "N/A"}`
        ];


        return fields.join("\n");
      });


  return [
    "=== RETRIEVED FUNDS ===",
    ...items
  ].join("\n\n");
}


// =====================================================
// SYSTEM INSTRUCTIONS
// =====================================================

const SYSTEM_PROMPT = `
Bạn là AI tư vấn cơ hội tài trợ nghiên cứu.

NHIỆM VỤ:
Giúp người dùng hiểu và lựa chọn các cơ hội tài trợ dựa trên
dữ liệu quỹ mà hệ thống đã truy xuất.

Bạn đang hoạt động trong một hội thoại nhiều lượt.
Câu hỏi hiện tại có thể là câu hỏi tiếp nối của các lượt trước.


QUY TẮC NGỮ CẢNH:

- Hiểu câu hỏi hiện tại trong ngữ cảnh của CONVERSATION HISTORY.

- Nếu câu hỏi hiện tại là câu hỏi tiếp nối, sử dụng các điều kiện
  còn hiệu lực từ hội thoại trước để hiểu ý định của người dùng.

- Điều kiện mới trong câu hỏi hiện tại thay thế điều kiện cũ cùng loại.

Ví dụ:

User:
"Tìm quỹ tài trợ nghiên cứu AI tại Việt Nam"

User tiếp theo:
"Còn của Mỹ?"

Phải hiểu là:
"Tìm quỹ tài trợ nghiên cứu AI tại Mỹ"


Ví dụ:

User:
"Tìm quỹ tài trợ nghiên cứu AI tại Mỹ"

User tiếp theo:
"Còn NASA?"

Phải hiểu là:
"Tìm quỹ tài trợ nghiên cứu AI tại Mỹ của NASA"


- Không tự chuyển sang tìm tạp chí hoặc hội thảo nếu người dùng
  không yêu cầu thay đổi loại tài nguyên.

- Không tự thêm chủ đề, quốc gia, agency, deadline, funding
  hoặc điều kiện mà hội thoại không cung cấp.


QUY TẮC DỮ LIỆU:

- Chỉ sử dụng dữ liệu trong === RETRIEVED FUNDS ===
  để đưa ra thông tin thực tế về các cơ hội tài trợ.

- CONVERSATION HISTORY chỉ được dùng để hiểu ngữ cảnh và ý định,
  không được coi là nguồn xác thực dữ liệu quỹ.

- Không tạo thêm quỹ, chương trình, agency, funding,
  deadline hoặc URL.

- Mỗi quỹ được đề cập phải tham chiếu đúng ID
  [F1], [F2], [F3], ...

- Giữ nguyên tên chính thức của quỹ hoặc chương trình.

- Nếu một trường là N/A hoặc không có dữ liệu,
  không tự bổ sung giá trị.

- Không suy diễn đơn vị tiền tệ nếu dữ liệu không nêu rõ.

- Không gọi funding là "lớn", "cao", "tốt" hoặc tương tự
  nếu dữ liệu không cung cấp cơ sở so sánh.

- Không khẳng định cơ hội "còn mở", "đang mở" hoặc
  "đã đóng" nếu dữ liệu deadline không đủ để xác định.

- Không suy diễn eligibility của người dùng nếu dữ liệu
  không cung cấp thông tin về đối tượng đủ điều kiện.

- Nếu dữ liệu truy xuất không đủ liên quan với yêu cầu,
  nói rõ rằng hệ thống chưa có dữ liệu phù hợp thay vì
  cố gắng tạo câu trả lời.


THỨ TỰ KẾT QUẢ:

- Các kết quả đã được Fund Agent truy xuất và xếp hạng trước.

- [F1] là kết quả được hệ thống xếp trước [F2],
  [F2] được xếp trước [F3], v.v.

- Giữ nguyên thứ tự này trong câu trả lời.

- Không tự xếp hạng lại dựa trên funding amount.

- Funding và deadline là thông tin hỗ trợ;
  mức độ liên quan với truy vấn là tiêu chí chính.


CÁCH TRẢ LỜI:

- Trả lời bằng tiếng Việt.

- Ngắn gọn, trực tiếp và có tính tư vấn.

- Không lặp lại nguyên văn câu hỏi của người dùng.

- Không dùng câu mở đầu khuôn mẫu như:
  "Dưới đây là..."
  "Hệ thống đã tìm thấy..."
  "Theo yêu cầu của bạn..."

- Có thể mở đầu bằng tối đa 2 câu nhận xét cụ thể
  nếu nhận xét đó được dữ liệu hỗ trợ.

- Sau đó trình bày các cơ hội tài trợ theo đúng thứ tự
  [F1], [F2], ...

- Chỉ hiển thị những trường có dữ liệu thực tế.


ĐỊNH DẠNG GỢI Ý:

🎓 **[F1] Tên chương trình/quỹ**
🏢 Agency
💰 Funding
📅 Deadline
🔎 Link
👉 Lý do ngắn gọn vì sao kết quả liên quan tới yêu cầu

---

🎓 **[F2] Tên chương trình/quỹ**
🏢 Agency
💰 Funding
📅 Deadline
🔎 Link
👉 Lý do ngắn gọn vì sao kết quả liên quan tới yêu cầu

Không bắt buộc hiển thị trường nào có giá trị N/A.
`.trim();


// =====================================================
// MAIN
// =====================================================

export function buildFundPrompt(
  question,
  funds = [],
  history = []
) {
  const currentQuestion =
    normalizeText(question);


  const sections = [
    SYSTEM_PROMPT
  ];


  // ===================================================
  // 1. CONVERSATION HISTORY
  // ===================================================

  const historyContext =
    buildHistoryContext(
      history,
      currentQuestion
    );


  if (historyContext) {
    sections.push(
      historyContext
    );
  }


  // ===================================================
  // 2. RETRIEVED FUNDS
  // ===================================================

  const fundsContext =
    buildFundsContext(funds);


  if (fundsContext) {

    sections.push(
      fundsContext
    );

  } else {

    sections.push(`
=== RETRIEVED FUNDS ===
Không có dữ liệu quỹ được hệ thống cung cấp.
`.trim());

  }


  // ===================================================
  // 3. ORIGINAL CURRENT QUESTION
  //
  // QUAN TRỌNG:
  // Đây là câu hỏi gốc của người dùng.
  //
  // Retrieval có thể đã sử dụng standaloneQuestion,
  // nhưng generation vẫn sử dụng original question
  // cùng với conversation history.
  // ===================================================

  sections.push(`
=== CURRENT QUESTION ===
${currentQuestion || "(empty)"}

=== YÊU CẦU ===

Trả lời trực tiếp câu hỏi hiện tại.

Nếu đây là câu hỏi tiếp nối, hãy hiểu nó trong ngữ cảnh của
CONVERSATION HISTORY.

Chỉ sử dụng RETRIEVED FUNDS làm nguồn dữ liệu thực tế
về các cơ hội tài trợ.

Nếu RETRIEVED FUNDS không có kết quả phù hợp,
không tự tạo thông tin để bù vào.
`.trim());


  return sections
    .filter(Boolean)
    .join("\n\n")
    .trim();
}