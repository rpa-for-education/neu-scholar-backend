// agents/fund/fund.prompt.js

// =====================================================
// CONFIG
// =====================================================

const MAX_FUNDS = 5;
const MAX_HISTORY = 3;
const MAX_HISTORY_CHARS = 500;
const MAX_SUMMARY_CHARS = 180;


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
    fund?.text ||
    fund?.description,
    MAX_SUMMARY_CHARS
  );
}


// =====================================================
// HISTORY
// =====================================================

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
    "=== HISTORY ===",
    ...items
  ].join("\n");
}


// =====================================================
// FUNDS
// =====================================================

function buildFundsContext(funds) {
  if (
    !Array.isArray(funds) ||
    !funds.length
  ) {
    return "";
  }

  const items = funds
    .slice(0, MAX_FUNDS)
    .map((fund, index) => {
      const id =
        `F${index + 1}`;

      return [
        `[${id}]`,
        `Title: ${getTitle(fund) || "N/A"}`,
        `Agency: ${getAgency(fund) || "N/A"}`,
        `Deadline: ${getDeadline(fund) || "N/A"}`,
        `Funding: ${getAmount(fund) || "N/A"}`,
        `Link: ${getLink(fund) || "N/A"}`,
        `Summary: ${getSummary(fund) || "N/A"}`
      ].join("\n");
    });

  return [
    "=== FUNDS ===",
    ...items
  ].join("\n\n");
}


// =====================================================
// SYSTEM INSTRUCTIONS
// =====================================================

const SYSTEM_PROMPT = `
Bạn là AI tư vấn cơ hội tài trợ nghiên cứu.

QUY TẮC:
- Chỉ sử dụng dữ liệu trong === FUNDS ===.
- Không tạo thêm quỹ, chương trình, agency, funding, deadline hoặc URL.
- Mỗi quỹ được đề cập phải tham chiếu đúng ID [F1], [F2], ...
- Giữ nguyên tên chính thức của quỹ/chương trình.
- Dữ liệu N/A hoặc không có thì không tự bổ sung.
- Không suy diễn đơn vị tiền tệ nếu dữ liệu không nêu rõ.
- Không gọi funding là "lớn", "cao", "tốt" nếu dữ liệu không đủ căn cứ so sánh.
- Không khẳng định quỹ còn mở nếu deadline không cho phép xác định điều đó.
- Nếu không có kết quả đủ liên quan, nói rõ không đủ dữ liệu phù hợp.
- Trả lời bằng tiếng Việt, ngắn gọn và trực tiếp.

XẾP HẠNG:
- Kết quả đã được hệ thống truy xuất và xếp hạng trước.
- Ưu tiên mức độ phù hợp với chủ đề/yêu cầu của người dùng.
- Funding và deadline chỉ là thông tin hỗ trợ, không được lấn át mức độ liên quan.
- Giữ thứ tự [F1], [F2], ... trừ khi dữ liệu cung cấp lý do rõ ràng để thay đổi.

ĐỊNH DẠNG:
- Mở đầu bằng tối đa 2 câu nhận xét cụ thể dựa trên dữ liệu.
- Không lặp lại câu hỏi.
- Không dùng câu mở đầu khuôn mẫu như "Dưới đây là..." hoặc "Hệ thống đã tìm thấy...".
- Sau phần mở đầu, trình bày các quỹ ngắn gọn.

Mẫu:

<Nhận xét ngắn dựa trên dữ liệu>

🔥 **Quỹ nổi bật nhất:**

🎓 **[F1] Tên quỹ**
🏢 Agency
💰 Funding (nếu có)
📅 Deadline (nếu có)
🔎 Link (nếu có)
👉 Một lý do ngắn gọn về mức độ phù hợp

---

🎓 **[F2] Tên quỹ**
🏢 Agency
💰 Funding (nếu có)
📅 Deadline (nếu có)
🔎 Link (nếu có)
👉 Một lý do ngắn gọn về mức độ phù hợp

Chỉ hiển thị trường có dữ liệu thực tế.
`.trim();


// =====================================================
// MAIN
// Giữ nguyên export/signature hiện tại.
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

  const historyContext =
    buildHistoryContext(history);

  if (historyContext) {
    sections.push(
      historyContext
    );
  }

  const fundsContext =
    buildFundsContext(funds);

  if (fundsContext) {
    sections.push(
      fundsContext
    );
  } else {
    sections.push(`
=== FUNDS ===
Không có dữ liệu quỹ được hệ thống cung cấp.
`.trim());
  }

  sections.push(`
=== QUESTION ===
${currentQuestion || "(empty)"}

=== YÊU CẦU ===
Trả lời trực tiếp câu hỏi dựa trên dữ liệu FUNDS ở trên.
Nếu FUNDS không có kết quả phù hợp, không tự tạo thông tin để bù vào.
`.trim());

  return sections
    .filter(Boolean)
    .join("\n\n")
    .trim();
}