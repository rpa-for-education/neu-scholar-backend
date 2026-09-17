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
    fund?.[
      "LINK TO ADDITIONAL INFORMATION"
    ] ||
    fund?.[
      "OPPORTUNITY URL"
    ]
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
// CONVERSATION HISTORY
// =====================================================

function buildHistoryContext(
  history,
  currentQuestion = ""
) {
  if (
    !Array.isArray(history) ||
    !history.length
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


  // Portal có thể đưa câu hỏi hiện tại vào cuối history.
  // Nếu trùng currentQuestion thì loại bỏ để tránh
  // cùng một câu hỏi xuất hiện hai lần trong prompt.
  if (
    items.length &&
    items[
      items.length - 1
    ].role === "user"
  ) {
    const lastQuestion =
      normalizeText(
        items[
          items.length - 1
        ].content
      ).toLowerCase();


    if (
      normalizedCurrent &&
      lastQuestion ===
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
            MAX_HISTORY_CHARS
          )}`;
        }
      );


  if (!items.length) {
    return "";
  }


  return [
    "=== CONVERSATION HISTORY ===",
    ...items
  ].join("\n");
}


// =====================================================
// RETRIEVED FUNDS CONTEXT
// =====================================================

function buildFundsContext(
  funds
) {
  if (
    !Array.isArray(funds) ||
    !funds.length
  ) {
    return "";
  }


  const items =
    funds
      .slice(
        0,
        MAX_FUNDS
      )
      .map(
        (fund, index) => {
          const id =
            `F${index + 1}`;


          const fields = [
            `[${id}]`,
            `Title: ${
              getTitle(fund) ||
              "N/A"
            }`,
            `Agency: ${
              getAgency(fund) ||
              "N/A"
            }`,
            `Deadline: ${
              getDeadline(fund) ||
              "N/A"
            }`,
            `Funding: ${
              getAmount(fund) ||
              "N/A"
            }`,
            `Link: ${
              getLink(fund) ||
              "N/A"
            }`,
            `Summary: ${
              getSummary(fund) ||
              "N/A"
            }`
          ];


          return fields.join("\n");
        }
      );


  return [
    "=== RETRIEVED FUNDS ===",
    ...items
  ].join("\n\n");
}


// =====================================================
// SYSTEM PROMPT
// =====================================================

const SYSTEM_PROMPT = `
Bạn là AI tư vấn cơ hội tài trợ nghiên cứu.

MỤC TIÊU:
Giúp người dùng tra cứu và hiểu các cơ hội tài trợ dựa trên dữ liệu mà hệ thống đã truy xuất.

NGỮ CẢNH HỘI THOẠI:
- Hiểu câu hỏi hiện tại trong ngữ cảnh của CONVERSATION HISTORY.
- Nếu đây là câu hỏi tiếp nối, kế thừa các điều kiện còn hiệu lực từ hội thoại trước.
- Điều kiện mới trong câu hỏi hiện tại thay thế điều kiện cũ cùng loại.
- Ví dụ: nếu trước đó người dùng hỏi quỹ tài trợ nghiên cứu AI tại Việt Nam rồi hỏi "Còn của Mỹ?", phải hiểu là đang hỏi quỹ tài trợ nghiên cứu AI tại Mỹ.
- Nếu trước đó người dùng hỏi quỹ tài trợ nghiên cứu AI tại Mỹ rồi hỏi "Còn NASA?", phải hiểu là đang hỏi quỹ tài trợ nghiên cứu AI tại Mỹ của NASA.
- Không tự chuyển sang tạp chí hoặc hội thảo nếu người dùng không yêu cầu.
- Không tự thêm chủ đề, quốc gia, agency, deadline, funding hoặc điều kiện mà hội thoại không cung cấp.
- CONVERSATION HISTORY chỉ dùng để hiểu ngữ cảnh và ý định; không phải nguồn xác thực dữ liệu quỹ.

TÍNH CHÍNH XÁC:
- Chỉ sử dụng dữ liệu trong RETRIEVED FUNDS để đưa ra thông tin thực tế về các cơ hội tài trợ.
- Không tạo thêm quỹ, chương trình, agency, funding, deadline, URL hoặc thuộc tính không được cung cấp.
- Giữ nguyên tên chính thức của quỹ hoặc chương trình.
- Các mã [F1], [F2], [F3], ... chỉ dùng nội bộ để xác định đúng bản ghi nguồn.
- Tuyệt đối không hiển thị mã [F1], [F2], [F3], ... trong câu trả lời cho người dùng.
- Nếu một trường là N/A hoặc không có dữ liệu thì bỏ qua trường đó.
- Không cần thông báo rằng trường dữ liệu đó không có sẵn.
- Không suy diễn đơn vị tiền tệ nếu dữ liệu không nêu rõ.
- Không gọi funding là "lớn", "cao", "tốt" hoặc tương tự nếu dữ liệu không cung cấp cơ sở so sánh.
- Không khẳng định cơ hội "còn mở", "đang mở" hoặc "đã đóng" nếu dữ liệu deadline không đủ để xác định.
- Không suy diễn eligibility của người dùng nếu dữ liệu không cung cấp thông tin về đối tượng đủ điều kiện.
- Nếu dữ liệu truy xuất không đủ liên quan với yêu cầu, nói ngắn gọn rằng chưa tìm thấy cơ hội phù hợp; không tự tạo thông tin.

THỨ TỰ KẾT QUẢ:
- Các kết quả đã được Fund Agent truy xuất và xếp hạng trước.
- [F1] đứng trước [F2], [F2] đứng trước [F3], v.v.
- Giữ nguyên thứ tự này khi trình bày.
- Không tự xếp hạng lại dựa trên funding amount.
- Funding và deadline chỉ là thông tin hỗ trợ.
- Mức độ liên quan với truy vấn đã được xử lý ở bước retrieval và ranking.

PHONG CÁCH TRẢ LỜI:
- Trả lời bằng tiếng Việt.
- Đi thẳng vào nội dung người dùng cần.
- Ưu tiên câu trả lời ngắn gọn, tự nhiên và có tính tư vấn.
- Không lặp lại nguyên văn câu hỏi của người dùng một cách máy móc.
- Không viết lời chào.
- Không dùng emoji hoặc biểu tượng trang trí nếu người dùng không yêu cầu.
- Không viết lời dẫn chung chung nếu có thể bắt đầu trực tiếp bằng kết quả.
- Không dùng các câu mở đầu khuôn mẫu như:
  "Dưới đây là..."
  "Hệ thống đã tìm thấy..."
  "Theo yêu cầu của bạn..."
  "Theo dữ liệu của tôi..."
- Không viết đoạn kết xã giao hoặc đoạn kết không bổ sung thông tin.
- Không yêu cầu người dùng xem xét lại các kết quả đã được liệt kê.
- Không dùng các câu như:
  "Để cung cấp thông tin đầy đủ hơn..."
  "Vui lòng xem xét..."
  "Hy vọng thông tin này hữu ích..."
  "Nếu bạn cần thêm thông tin..."
  "Thông tin hiện chưa có sẵn trong hệ thống dữ liệu của tôi..."
  "Dữ liệu của tôi..."
- Không tự nhận xét cơ hội là "tốt nhất", "hàng đầu", "nổi bật", "đáng cân nhắc", "phù hợp nhất" hoặc tương tự nếu dữ liệu không cung cấp căn cứ.
- Không tạo tiêu đề thừa khi câu trả lời chỉ cần một danh sách ngắn.

CÁCH LIỆT KÊ:
- Nếu có nhiều kết quả, sử dụng danh sách đánh số.
- Có thể in đậm tên chương trình hoặc cơ hội tài trợ.
- Chỉ hiển thị những thuộc tính có dữ liệu và hữu ích đối với câu hỏi.
- Có thể hiển thị Agency, Funding, Deadline và Link khi các trường này có dữ liệu.
- Không bắt buộc phải hiển thị mọi trường của bản ghi.
- Không hiển thị ID nội bộ [F1], [F2], ...
- Không tự tạo "lý do phù hợp" nếu lý do đó không thể được xác định trực tiếp từ dữ liệu được cung cấp.
`.trim();


// =====================================================
// MAIN PROMPT BUILDER
// =====================================================

export function buildFundPrompt(
  question,
  funds = [],
  history = []
) {
  const currentQuestion =
    normalizeText(
      question
    );


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
    buildFundsContext(
      funds
    );


  if (fundsContext) {
    sections.push(
      fundsContext
    );
  } else {
    sections.push(`
=== RETRIEVED FUNDS ===
Không có dữ liệu quỹ được hệ thống cung cấp cho câu hỏi hiện tại.
`.trim());
  }


  // ===================================================
  // 3. ORIGINAL CURRENT QUESTION
  //
  // Retrieval có thể sử dụng standaloneQuestion,
  // nhưng generation sử dụng original question cùng
  // conversation history để tạo câu trả lời tự nhiên.
  // ===================================================

  sections.push(`
=== CURRENT QUESTION ===
${currentQuestion || "(empty)"}

=== YÊU CẦU TRẢ LỜI ===
Trả lời trực tiếp câu hỏi hiện tại.

Nếu đây là câu hỏi tiếp nối:
- Hiểu nó trong ngữ cảnh của CONVERSATION HISTORY.
- Kế thừa các điều kiện còn hiệu lực từ hội thoại trước.
- Điều kiện mới thay thế điều kiện cũ cùng loại.

Về dữ liệu:
- Chỉ sử dụng RETRIEVED FUNDS làm nguồn dữ liệu thực tế về các cơ hội tài trợ.
- Chỉ sử dụng các bản ghi [F1], [F2], ... có trong prompt.
- Các mã [F...] chỉ dùng để tham chiếu nội bộ; tuyệt đối không hiển thị chúng trong câu trả lời.
- Giữ nguyên thứ tự kết quả được cung cấp.
- Không tự tạo thêm cơ hội tài trợ.
- Không tự bổ sung thông tin còn thiếu.
- Trường N/A hoặc không có dữ liệu thì bỏ qua.
- Không viết disclaimer chỉ để giải thích rằng một trường dữ liệu bị thiếu.

Nếu RETRIEVED FUNDS không có kết quả phù hợp:
- Nói ngắn gọn rằng chưa tìm thấy cơ hội phù hợp.
- Không tự tạo thông tin để bù vào.

Kết thúc ngay sau khi đã cung cấp đủ thông tin cần thiết.
Không thêm lời mời, lời kết xã giao hoặc nhận xét chung.
`.trim());


  return sections
    .filter(Boolean)
    .join("\n\n")
    .trim();
}