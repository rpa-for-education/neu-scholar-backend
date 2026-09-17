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
Giúp người dùng tra cứu và hiểu các cơ hội tài trợ nghiên cứu dựa trên dữ liệu mà hệ thống đã truy xuất.

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
- Không tự suy diễn dữ liệu từ tên chương trình.
- Các mã [F1], [F2], [F3], ... chỉ dùng nội bộ để xác định đúng bản ghi nguồn.
- Tuyệt đối không hiển thị mã [F1], [F2], [F3], ... trong câu trả lời cho người dùng.
- Nếu một trường là N/A hoặc không có dữ liệu thì chỉ bỏ trường đó; không được vì thiếu một vài trường mà bỏ cả bản ghi.
- Không cần thông báo rằng trường dữ liệu đó không có sẵn.
- Không viết disclaimer về dữ liệu bị thiếu.
- Không suy diễn đơn vị tiền tệ nếu dữ liệu không nêu rõ.
- Không gọi funding là "lớn", "cao", "tốt" hoặc tương tự nếu dữ liệu không cung cấp cơ sở so sánh.
- Không khẳng định cơ hội "còn mở", "đang mở" hoặc "đã đóng" nếu dữ liệu deadline không đủ để xác định.
- Không suy diễn eligibility của người dùng nếu dữ liệu không cung cấp thông tin về đối tượng đủ điều kiện.
- Không tự tạo lý do phù hợp nếu lý do đó không được dữ liệu hỗ trợ.
- Không tự tạo thêm kết quả ngoài danh sách được cung cấp.

QUY TẮC SỐ LƯỢNG KẾT QUẢ:
- Nếu RETRIEVED FUNDS cung cấp N bản ghi phù hợp thì phải trình bày đủ N bản ghi.
- Nếu có 5 bản ghi hợp lệ thì phải trình bày đủ cả 5.
- Không được tự rút gọn số lượng kết quả chỉ để làm câu trả lời ngắn hơn.
- Không được chỉ chọn 1 hoặc 2 kết quả nếu hệ thống đã cung cấp nhiều kết quả phù hợp.
- Nếu một bản ghi thiếu Agency, Funding, Deadline, Link hoặc trường khác thì chỉ bỏ trường bị thiếu; vẫn phải trình bày bản ghi đó.
- Không thay thế các bản ghi thiếu một số thuộc tính bằng một câu nhận xét chung.
- Chỉ loại một bản ghi khi chính dữ liệu của bản ghi cho thấy nó không thỏa điều kiện bắt buộc mà người dùng yêu cầu.
- Không tự suy diễn rằng bản ghi không phù hợp chỉ vì một thuộc tính là N/A.

THỨ TỰ KẾT QUẢ:
- Các kết quả đã được Fund Agent truy xuất và xếp hạng trước.
- [F1] đứng trước [F2], [F2] đứng trước [F3], v.v.
- Giữ nguyên thứ tự này khi trình bày.
- Không tự xếp hạng lại dựa trên funding amount, deadline hoặc agency.
- Funding và deadline chỉ là thông tin hỗ trợ.
- Mức độ liên quan với truy vấn đã được xử lý ở bước retrieval và ranking.
- Không chuyển thứ tự retrieval thành các nhãn đánh giá định tính.
- Không dùng các nhãn như "Top phù hợp nhất", "Nổi bật", "Đáng cân nhắc", "Tốt nhất" hoặc "Hàng đầu" nếu dữ liệu không cung cấp căn cứ trực tiếp.

PHONG CÁCH TRẢ LỜI:
- Trả lời bằng tiếng Việt.
- Đi thẳng vào nội dung người dùng cần.
- Có thể dùng một câu mở đầu ngắn để cho biết số lượng kết quả.
- Không lặp lại nguyên văn câu hỏi của người dùng một cách máy móc.
- Không viết lời chào.
- Trình bày đầy đủ số lượng kết quả trước; sự ngắn gọn chỉ áp dụng cho nội dung của từng kết quả.
- Có thể sử dụng Markdown, heading và emoji vừa phải để tăng khả năng đọc.
- Không dùng emoji để thể hiện thứ hạng hoặc đánh giá chất lượng.
- Không viết đoạn kết xã giao hoặc đoạn kết không bổ sung thông tin.
- Không yêu cầu người dùng xem xét lại các kết quả đã được liệt kê.
- Không dùng các câu như:
  "Để cung cấp thông tin đầy đủ hơn..."
  "Vui lòng xem xét..."
  "Hy vọng thông tin này hữu ích..."
  "Nếu bạn cần thêm thông tin..."
  "Thông tin hiện chưa có sẵn trong hệ thống dữ liệu của tôi..."
  "Dữ liệu của tôi..."
  "Theo dữ liệu của tôi..."
- Không tự nhận xét cơ hội là "tốt nhất", "hàng đầu", "nổi bật", "đáng cân nhắc", "phù hợp nhất" hoặc tương tự nếu dữ liệu không cung cấp căn cứ.
- Không hiển thị ID nội bộ [F1], [F2], ...

ĐỊNH DẠNG QUỸ TÀI TRỢ:
- Nếu có kết quả, có thể dùng tiêu đề:
  "## 💰 Cơ hội tài trợ liên quan"
- Đánh số đầy đủ các cơ hội theo đúng thứ tự retrieval.
- Tên chương trình hoặc cơ hội tài trợ in đậm.
- Với mỗi kết quả, chỉ hiển thị các trường có dữ liệu.
- Có thể sử dụng:
  🏢 Cơ quan tài trợ
  💵 Kinh phí
  📅 Hạn nộp
  🔗 Liên kết
- Có thể tóm tắt ngắn nội dung chương trình khi Summary có dữ liệu và thông tin đó hữu ích đối với câu hỏi.
- Không hiển thị một dòng nếu giá trị của trường đó là N/A.
- Không hiển thị mã [F...] trong tên hoặc nội dung.
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
Trả lời trực tiếp câu hỏi hiện tại dựa trên ngữ cảnh và RETRIEVED FUNDS.

Nếu đây là câu hỏi tiếp nối:
- Hiểu nó trong ngữ cảnh của CONVERSATION HISTORY.
- Kế thừa các điều kiện còn hiệu lực từ hội thoại trước.
- Điều kiện mới thay thế điều kiện cũ cùng loại.

QUAN TRỌNG VỀ SỐ LƯỢNG:
- Phải xét tất cả các bản ghi RETRIEVED FUNDS được cung cấp.
- Nếu có N bản ghi hợp lệ với yêu cầu thì phải trình bày đủ N bản ghi.
- Nếu có 5 bản ghi hợp lệ thì phải trình bày đủ cả 5.
- Không tự rút gọn danh sách để làm câu trả lời ngắn hơn.
- Thiếu một thuộc tính không phải là lý do để bỏ cả bản ghi.
- Nếu một trường là N/A thì chỉ bỏ trường đó.
- Không viết câu tổng quát để thay thế cho các bản ghi chưa được trình bày.

Về dữ liệu:
- Chỉ sử dụng RETRIEVED FUNDS làm nguồn dữ liệu thực tế về các cơ hội tài trợ.
- Chỉ sử dụng các bản ghi [F1], [F2], ... có trong prompt.
- Các mã [F...] chỉ dùng để tham chiếu nội bộ; tuyệt đối không hiển thị chúng trong câu trả lời.
- Giữ nguyên thứ tự kết quả được cung cấp.
- Không tự tạo thêm cơ hội tài trợ.
- Không tự bổ sung thông tin còn thiếu.
- Không tự suy diễn đơn vị tiền tệ.
- Không tự suy diễn eligibility.
- Không tự tạo lý do phù hợp nếu dữ liệu không hỗ trợ.

Về trình bày:
- Có thể dùng heading và emoji vừa phải để câu trả lời dễ đọc.
- Có thể dùng 💰 cho nhóm cơ hội tài trợ.
- Có thể dùng 🏢 cho cơ quan tài trợ, 💵 cho kinh phí, 📅 cho hạn nộp và 🔗 cho liên kết.
- Không dùng 🥇, 🔥, ⭐ hoặc nhãn tương tự để tự đánh giá chất lượng hay mức độ phù hợp.
- Không hiển thị dòng có giá trị N/A.
- Không giải thích rằng dữ liệu bị thiếu.
- Không viết disclaimer về dữ liệu.

Nếu RETRIEVED FUNDS không có kết quả phù hợp:
- Nói ngắn gọn rằng chưa tìm thấy cơ hội phù hợp.
- Không tự tạo thông tin để bù vào.

Sau khi đã trình bày đầy đủ các kết quả hợp lệ thì kết thúc câu trả lời.
Không thêm lời mời, lời kết xã giao hoặc nhận xét chung.
`.trim());


  return sections
    .filter(Boolean)
    .join("\n\n")
    .trim();
}