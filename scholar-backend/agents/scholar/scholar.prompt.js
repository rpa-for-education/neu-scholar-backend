// agents/scholar/scholar.prompt.js


// =====================================================
// CONFIG
// =====================================================

const MAX_HISTORY = 6;
const MAX_HISTORY_CHARS_PER_ITEM = 700;

const MAX_PROFILE_CHARS = 2000;
const MAX_PROJECT_CHARS = 2500;
const MAX_DOC_CHARS = 5000;

const MAX_RETRIEVAL_TEXT_CHARS = 1000;


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
      .filter(
        item =>
          item !== null &&
          item !== undefined
      )
      .map(normalizeText)
      .filter(Boolean)
      .join(", ");
  }

  return normalizeText(value);
}


// =====================================================
// FIELD VALUE UTILS
// =====================================================

function isMissingValue(value) {
  const text =
    normalizeText(value)
      .toLowerCase();

  return (
    !text ||
    text === "n/a" ||
    text === "na" ||
    text === "null" ||
    text === "undefined"
  );
}


function firstValue(...values) {
  for (const value of values) {
    const text =
      normalizeText(value);

    if (!isMissingValue(text)) {
      return text;
    }
  }

  return "";
}


function firstArrayValue(...values) {
  for (const value of values) {
    const text =
      joinArray(value);

    if (!isMissingValue(text)) {
      return text;
    }
  }

  return "";
}


function booleanValue(value) {
  if (
    value === true ||
    value === 1
  ) {
    return "Yes";
  }

  if (
    value === false ||
    value === 0
  ) {
    return "No";
  }

  const text =
    normalizeText(value)
      .toLowerCase();

  if (
    text === "true" ||
    text === "yes" ||
    text === "y"
  ) {
    return "Yes";
  }

  if (
    text === "false" ||
    text === "no" ||
    text === "n"
  ) {
    return "No";
  }

  return "";
}


// =====================================================
// CONTEXT FIELD BUILDER
//
// Missing fields are omitted entirely.
//
// This avoids filling the internal prompt with "N/A".
// =====================================================

function contextField(
  label,
  value
) {
  const text =
    normalizeText(value);

  if (isMissingValue(text)) {
    return "";
  }

  return `${label}: ${text}`;
}


function buildRecord(
  id,
  title,
  fields = []
) {
  const header =
    `[${id}] ${title}`;

  const validFields =
    fields.filter(Boolean);

  if (!validFields.length) {
    return header;
  }

  return [
    header,
    ...validFields.map(
      field => ` | ${field}`
    )
  ].join("");
}


// =====================================================
// DATE / CONFERENCE TEMPORAL STATUS
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


/*
 * This is deliberately named temporal status.
 *
 * It describes the CFP/event timing inferred from
 * deadline/start date.
 *
 * It is NOT the same thing as a stored database
 * workflow/crawl status such as "completed".
 */
function getTemporalStatus(
  conference
) {
  const now =
    Date.now();

  const deadline =
    safeTime(
      firstValue(
        conference?.deadline,
        conference?.submission_deadline,
        conference?.paper_deadline,
        conference?.cfp_deadline,
        conference?.close_date
      )
    );

  const start =
    safeTime(
      firstValue(
        conference?.start_date,
        conference?.event_date,
        conference?.conference_date,
        conference?.date
      )
    );

  const end =
    safeTime(
      firstValue(
        conference?.end_date,
        conference?.event_end_date,
        conference?.conference_end_date
      )
    );


  /*
   * If an explicit end date exists and is already past,
   * the event itself is past.
   */
  if (
    end !== null &&
    end < now
  ) {
    return "past_event";
  }


  /*
   * Deadline still open.
   */
  if (
    deadline !== null &&
    deadline > now
  ) {
    const diffDays =
      (deadline - now) /
      86_400_000;

    return diffDays <= 30
      ? "submission_soon"
      : "submission_open";
  }


  /*
   * Deadline passed, but event has not started.
   */
  if (
    start !== null &&
    start > now
  ) {
    return "upcoming_event";
  }


  /*
   * Start date is already past.
   *
   * Without an end date we cannot know whether
   * a multi-day event is currently running, so
   * "started_or_past_event" is safer than making
   * a stronger claim.
   */
  if (
    start !== null &&
    start <= now
  ) {
    return "started_or_past_event";
  }


  /*
   * We only know that submission is closed.
   */
  if (
    deadline !== null &&
    deadline <= now
  ) {
    return "submission_closed";
  }


  return "";
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
          !isMissingValue(value)
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


  if (!isMissingValue(name)) {
    lines.push(
      `Tên: ${name}`
    );
  }


  if (
    !isMissingValue(
      description
    )
  ) {
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
  if (!Array.isArray(history)) {
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


  /*
   * Portal may include current question as the last
   * user message in history.
   *
   * Remove that duplicate because the current question
   * is added separately below.
   */
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
    !Array.isArray(conferences) ||
    !conferences.length
  ) {
    return "";
  }


  /*
   * IMPORTANT:
   *
   * Do NOT slice here.
   *
   * scholar.service.js / scholar.search.js owns topk.
   * Every record passed into this prompt should remain
   * visible to the LLM.
   */
  const items =
    conferences.map(
      (
        conference,
        index
      ) => {

        // -----------------------------------------------
        // NAME / TITLE
        // -----------------------------------------------

        const title =
          firstValue(
            conference?.name,
            conference?.title,
            conference?.conference_name,
            conference?.event_name,
            conference?.acronym
          ) ||
          "Untitled conference";


        // -----------------------------------------------
        // ACRONYM
        // -----------------------------------------------

        const acronym =
          firstValue(
            conference?.acronym,
            conference?.short_name,
            conference?.abbreviation
          );


        // -----------------------------------------------
        // LOCATION
        // -----------------------------------------------

        const city =
          firstValue(
            conference?.city,
            conference?.location_city
          );


        const country =
          firstValue(
            conference?.country,
            conference?.country_name,
            conference?.location_country
          );


        const composedLocation =
          [
            city,
            country
          ]
            .filter(Boolean)
            .join(", ");


        const location =
          firstValue(
            conference?.location,
            conference?.venue,
            conference?.place,
            composedLocation
          );


        // -----------------------------------------------
        // TOPICS / FIELDS
        // -----------------------------------------------

        const topics =
          firstArrayValue(
            conference?.topics,
            conference?.topic,
            conference?.fields,
            conference?.field,
            conference?.categories,
            conference?.category,
            conference?.areas,
            conference?.area,
            conference?.subjects,
            conference?.subject,
            conference?.keywords,
            conference?.keyword
          );


        // -----------------------------------------------
        // DATES
        // -----------------------------------------------

        const deadline =
          firstValue(
            conference?.deadline,
            conference?.submission_deadline,
            conference?.paper_deadline,
            conference?.cfp_deadline,
            conference?.close_date
          );


        const startDate =
          firstValue(
            conference?.start_date,
            conference?.event_date,
            conference?.conference_date,
            conference?.date
          );


        const endDate =
          firstValue(
            conference?.end_date,
            conference?.event_end_date,
            conference?.conference_end_date
          );


        // -----------------------------------------------
        // STORED STATUS
        //
        // Keep it separate from temporal status because
        // a value such as "completed" may describe crawl
        // processing rather than event timing.
        // -----------------------------------------------

        const storedStatus =
          firstValue(
            conference?.status,
            conference?.event_status,
            conference?.submission_status
          );


        const temporalStatus =
          getTemporalStatus(
            conference
          );


        // -----------------------------------------------
        // SOURCE
        // -----------------------------------------------

        const source =
          firstValue(
            conference?.source,
            conference?.data_source,
            conference?.provider
          );


        // -----------------------------------------------
        // URL
        // -----------------------------------------------

        const url =
          firstValue(
            conference?.url,
            conference?.cfp_link,
            conference?.link,
            conference?.website,
            conference?.homepage,
            conference?.conference_url
          );


        // -----------------------------------------------
        // CFP TEXT
        // -----------------------------------------------

        const cfpText =
          truncate(
            firstValue(
              conference?.cfp_text,
              conference?.cfp,
              conference?.description,
              conference?.text,
              conference?.summary
            ),
            MAX_RETRIEVAL_TEXT_CHARS
          );


        // -----------------------------------------------
        // CRAWL SOURCE
        // -----------------------------------------------

        const crawlSource =
          firstValue(
            conference?.crawl_source,
            conference?.crawler,
            conference?.crawl_method
          );


        // -----------------------------------------------
        // ENRICHED
        // -----------------------------------------------

        const enriched =
          booleanValue(
            conference?.is_enriched ??
            conference?.enriched
          );


        // -----------------------------------------------
        // INTERNAL KEY
        // -----------------------------------------------

        const key =
          firstValue(
            conference?._key,
            conference?.u_key,
            conference?.key
          );


        // -----------------------------------------------
        // INTERNAL RETRIEVAL CONTEXT
        //
        // Missing fields are omitted.
        // -----------------------------------------------

        return buildRecord(
          `C${index + 1}`,
          title,
          [
            contextField(
              "acronym",
              acronym
            ),

            contextField(
              "location",
              location
            ),

            contextField(
              "city",
              city
            ),

            contextField(
              "country",
              country
            ),

            contextField(
              "topics",
              topics
            ),

            contextField(
              "deadline",
              deadline
            ),

            contextField(
              "start_date",
              startDate
            ),

            contextField(
              "end_date",
              endDate
            ),

            contextField(
              "stored_status",
              storedStatus
            ),

            contextField(
              "temporal_status",
              temporalStatus
            ),

            contextField(
              "source",
              source
            ),

            contextField(
              "url",
              url
            ),

            contextField(
              "cfp_text",
              cfpText
            ),

            contextField(
              "crawl_source",
              crawlSource
            ),

            contextField(
              "is_enriched",
              enriched
            ),

            contextField(
              "key",
              key
            )
          ]
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
    !Array.isArray(journals) ||
    !journals.length
  ) {
    return "";
  }


  /*
   * IMPORTANT:
   *
   * Do NOT slice here.
   *
   * The retrieval/service layer owns topk.
   */
  const items =
    journals.map(
      (
        journal,
        index
      ) => {

        // -----------------------------------------------
        // TITLE
        // -----------------------------------------------

        const title =
          firstValue(
            journal?.title,
            journal?.name,
            journal?.journal_title,
            journal?.source_title,
            journal?.publication_title
          ) ||
          "Untitled journal";


        // -----------------------------------------------
        // PUBLISHER
        // -----------------------------------------------

        const publisher =
          firstValue(
            journal?.publisher,
            journal?.publisher_name,
            journal?.publisher_alt,
            journal?.organization
          );


        // -----------------------------------------------
        // QUARTILE
        //
        // IMPORTANT:
        //
        // Only explicit journal-level quartile fields
        // are accepted.
        //
        // Do NOT infer overall journal quartile from
        // categories such as:
        //
        // "Education (Q1); Computer Science (Q2)"
        //
        // because category quartiles are not necessarily
        // equivalent to the canonical journal quartile.
        // -----------------------------------------------

        const quartile =
          firstValue(
            journal?.quartile,
            journal?.sjr_best_quartile,
            journal?.best_quartile,
            journal?.sjr_quartile,
            journal?.q
          );


        // -----------------------------------------------
        // FIELD / CATEGORY / AREA
        // -----------------------------------------------

        const fields =
          firstArrayValue(
            journal?.fields,
            journal?.field,
            journal?.categories,
            journal?.category,
            journal?.areas,
            journal?.area,
            journal?.subjects,
            journal?.subject,
            journal?.topics,
            journal?.topic
          );


        // -----------------------------------------------
        // COUNTRY
        // -----------------------------------------------

        const country =
          firstValue(
            journal?.country,
            journal?.country_name,
            journal?.nation
          );


        // -----------------------------------------------
        // REGION
        // -----------------------------------------------

        const region =
          firstValue(
            journal?.region,
            journal?.continent
          );


        // -----------------------------------------------
        // ISSN
        // -----------------------------------------------

        const issn =
          firstArrayValue(
            journal?.issn,
            journal?.primary_issn,
            journal?.eissn,
            journal?.pissn
          );


        // -----------------------------------------------
        // SJR
        // -----------------------------------------------

        const sjr =
          firstValue(
            journal?.sjr,
            journal?.sjr_score,
            journal?.score
          );


        // -----------------------------------------------
        // H-INDEX
        // -----------------------------------------------

        const hIndex =
          firstValue(
            journal?.h_index,
            journal?.hindex,
            journal?.hIndex
          );


        // -----------------------------------------------
        // RANK
        // -----------------------------------------------

        const rank =
          firstValue(
            journal?.rank,
            journal?.scimago_rank
          );


        // -----------------------------------------------
        // COVERAGE
        // -----------------------------------------------

        const coverage =
          firstValue(
            journal?.coverage,
            journal?.coverage_years
          );


        // -----------------------------------------------
        // OPEN ACCESS
        // -----------------------------------------------

        const openAccess =
          booleanValue(
            journal?.open_access ??
            journal?.openAccess ??
            journal?.is_open_access ??
            journal?.oa
          );


        // -----------------------------------------------
        // OPEN ACCESS DIAMOND
        // -----------------------------------------------

        const openAccessDiamond =
          booleanValue(
            journal?.open_access_diamond ??
            journal?.openAccessDiamond ??
            journal?.is_open_access_diamond
          );


        // -----------------------------------------------
        // CITATIONS / DOCUMENT METRICS
        // -----------------------------------------------

        const citationsPerDoc =
          firstValue(
            journal?.citations_per_doc_2years,
            journal?.cites_per_doc_2years,
            journal?.citations_doc_2years
          );


        const citableDocs =
          firstValue(
            journal?.citable_docs_3years,
            journal?.citable_docs
          );


        // -----------------------------------------------
        // URL
        // -----------------------------------------------

        const url =
          firstValue(
            journal?.scimago_link,
            journal?.url,
            journal?.link,
            journal?.website,
            journal?.homepage,
            journal?.journal_url
          );


        // -----------------------------------------------
        // SEARCHABLE TEXT
        // -----------------------------------------------

        const text =
          truncate(
            firstValue(
              journal?.text,
              journal?.description,
              journal?.abstract
            ),
            MAX_RETRIEVAL_TEXT_CHARS
          );


        // -----------------------------------------------
        // INTERNAL RETRIEVAL CONTEXT
        //
        // Missing fields are omitted.
        // -----------------------------------------------

        return buildRecord(
          `J${index + 1}`,
          title,
          [
            contextField(
              "publisher",
              publisher
            ),

            contextField(
              "quartile",
              quartile
            ),

            contextField(
              "field",
              fields
            ),

            contextField(
              "country",
              country
            ),

            contextField(
              "region",
              region
            ),

            contextField(
              "issn",
              issn
            ),

            contextField(
              "sjr",
              sjr
            ),

            contextField(
              "h_index",
              hIndex
            ),

            contextField(
              "rank",
              rank
            ),

            contextField(
              "coverage",
              coverage
            ),

            contextField(
              "open_access",
              openAccess
            ),

            contextField(
              "open_access_diamond",
              openAccessDiamond
            ),

            contextField(
              "citations_per_doc_2years",
              citationsPerDoc
            ),

            contextField(
              "citable_docs_3years",
              citableDocs
            ),

            contextField(
              "url",
              url
            ),

            contextField(
              "text",
              text
            )
          ]
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

QUY TẮC DỮ LIỆU THIẾU:
- Trường không xuất hiện trong retrieval context có nghĩa là hệ thống không có dữ liệu cho trường đó.
- Không tự điền, suy đoán hoặc suy diễn giá trị còn thiếu.
- Nếu một thuộc tính không có dữ liệu thì bỏ toàn bộ thuộc tính đó khỏi phần trình bày.
- Không được vì thiếu một hoặc nhiều thuộc tính mà bỏ cả bản ghi.
- Thiếu dữ liệu KHÔNG đồng nghĩa với việc bản ghi không đáp ứng điều kiện.
- Đặc biệt, thiếu quartile KHÔNG có nghĩa là "không phải Q1", "không phải Q2", "không phải Q3" hoặc "không phải Q4".
- Không được kết luận một tạp chí "không đáp ứng Q1/Q2/Q3/Q4" chỉ vì quartile không được cung cấp.
- Không được viết "không có tạp chí nào đáp ứng..." nếu nguyên nhân duy nhất là dữ liệu quartile bị thiếu.
- Nếu quartile có giá trị cụ thể và khác quartile người dùng yêu cầu thì mới được xác định rằng bản ghi đó không thỏa điều kiện quartile.
- Nếu tất cả các kết quả liên quan đều thiếu quartile trong khi người dùng yêu cầu quartile cụ thể, chỉ nói một câu ngắn rằng dữ liệu hiện có chưa đủ để xác nhận quartile; sau đó vẫn trình bày các kết quả liên quan.
- Không lặp lại lời giải thích về dữ liệu thiếu ở cuối câu trả lời.
- Không viết disclaimer dài về dữ liệu thiếu.
- Tuyệt đối không hiển thị "N/A", "null" hoặc "undefined" cho người dùng.

QUY TẮC SỐ LƯỢNG KẾT QUẢ:
- Phải xét tất cả các bản ghi retrieval được cung cấp trong prompt.
- Nếu hệ thống cung cấp N bản ghi liên quan thì phải trình bày đủ N bản ghi, trừ bản ghi có dữ liệu cụ thể chứng minh rằng nó trái với điều kiện bắt buộc của người dùng.
- Không được tự rút gọn số lượng kết quả chỉ để làm câu trả lời ngắn hơn.
- Không được chỉ chọn một phần kết quả khi hệ thống đã cung cấp nhiều kết quả liên quan.
- Thiếu publisher, country, quartile, URL hoặc thuộc tính khác không phải là lý do để bỏ bản ghi.
- Không thay thế các bản ghi thiếu thuộc tính bằng một câu nhận xét chung.

THỨ TỰ KẾT QUẢ:
- Giữ nguyên thứ tự kết quả mà hệ thống cung cấp.
- Không tự xếp hạng lại.
- Không chuyển thứ tự retrieval thành các nhãn đánh giá định tính.
- Không dùng các nhãn như "Top phù hợp nhất", "Nổi bật", "Đáng cân nhắc", "Tốt nhất", "Hàng đầu" nếu dữ liệu không cung cấp căn cứ trực tiếp.
- Không giải thích cho người dùng về cơ chế retrieval hoặc ranking nội bộ.

HỘI THẢO - TRẠNG THÁI:
- stored_status là trạng thái được lưu trong dữ liệu nguồn và có thể phản ánh trạng thái xử lý/crawl.
- temporal_status là trạng thái thời gian được suy ra từ deadline và ngày tổ chức.
- Không được tự hiểu stored_status="completed" là hội thảo đã kết thúc nếu ngày tháng không chứng minh điều đó.
- Khi người dùng hỏi hội thảo còn nhận bài hay sắp diễn ra, ưu tiên deadline, start_date, end_date và temporal_status.
- Không biến trạng thái crawl/enrichment thành trạng thái học thuật của hội thảo.

QUARTILE TẠP CHÍ:
- Chỉ trường quartile trong retrieval context được dùng làm quartile chính thức của bản ghi.
- Không suy ra quartile tổng thể của tạp chí từ chuỗi categories, areas hoặc fields.
- Ví dụ "Education (Q1); Computer Science (Q2)" trong category không đủ để tự kết luận quartile tổng thể của tạp chí nếu trường quartile không được cung cấp.

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

Định dạng cơ bản:

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
- Tuyệt đối không hiển thị "N/A", "null" hoặc "undefined".
- Không ghép Publisher, Country, Quartile hoặc URL trên cùng dòng với tên tạp chí.
- Không ghép nhiều thuộc tính trên cùng một dòng.
- Không hiển thị mã [J...].
- Các trường region, ISSN, SJR, H-index, rank, coverage và open access là dữ liệu hỗ trợ.
- Chỉ hiển thị các trường hỗ trợ này khi người dùng hỏi hoặc khi chúng trực tiếp cần thiết để trả lời câu hỏi.

ĐỊNH DẠNG HỘI THẢO:
- Nếu có kết quả hội thảo, dùng tiêu đề:
  "## 🎓 Hội thảo liên quan"
- Mỗi hội thảo phải là một block riêng.
- Đánh số đầy đủ theo đúng thứ tự retrieval.
- Tên hội thảo nằm trên một dòng riêng và được in đậm.
- Mỗi thuộc tính nằm trên một dòng riêng bên dưới tên.
- Giữa hai hội thảo có một dòng trống.
- Không dùng "---" để phân cách.

Định dạng cơ bản:

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
- Tuyệt đối không hiển thị "N/A", "null" hoặc "undefined".
- Không ghép nhiều thuộc tính trên cùng một dòng.
- Không hiển thị mã [C...].
- Acronym, topics, stored_status, temporal_status, source và CFP text là dữ liệu hỗ trợ.
- Chỉ hiển thị các trường hỗ trợ khi người dùng hỏi hoặc khi chúng trực tiếp cần thiết để trả lời câu hỏi.
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

Nếu người dùng đang yêu cầu hội thảo hoặc tạp chí cụ thể thì trả lời ngắn gọn rằng chưa tìm thấy kết quả phù hợp trong dữ liệu được truy xuất. Không tự tạo kết quả.
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
- Phải xét tất cả các bản ghi retrieval được cung cấp trong prompt.
- Nếu có N bản ghi liên quan thì phải trình bày đủ N bản ghi, trừ khi dữ liệu cụ thể của bản ghi chứng minh rằng nó trái với điều kiện bắt buộc của người dùng.
- Không tự rút gọn danh sách để làm câu trả lời ngắn hơn.
- Thiếu một thuộc tính không phải là lý do để bỏ cả bản ghi.
- Không viết một câu tổng quát để thay thế cho các bản ghi chưa được trình bày.

QUAN TRỌNG VỀ DỮ LIỆU THIẾU:
- Trường không xuất hiện trong retrieval context có nghĩa là không có dữ liệu cho trường đó.
- Không tự suy diễn giá trị cho trường bị thiếu.
- Không hiển thị "N/A", "null" hoặc "undefined".
- Thiếu dữ liệu không có nghĩa là bản ghi không đáp ứng điều kiện.
- Thiếu quartile không có nghĩa là tạp chí không phải Q1/Q2/Q3/Q4.
- Không được kết luận "không có tạp chí nào đáp ứng quartile yêu cầu" chỉ vì quartile bị thiếu.
- Nếu quartile có dữ liệu cụ thể và khác quartile được yêu cầu thì mới được loại bản ghi vì lý do quartile.
- Nếu tất cả kết quả liên quan đều thiếu quartile, chỉ nói một câu ngắn rằng dữ liệu hiện có chưa đủ để xác nhận quartile; sau đó vẫn trình bày các kết quả liên quan.

Nếu liệt kê hội thảo:
- Chỉ sử dụng các bản ghi [C1], [C2], ... được cung cấp trong prompt.
- Các mã [C...] chỉ dùng để tham chiếu nội bộ; tuyệt đối không hiển thị chúng trong câu trả lời.
- Giữ nguyên thứ tự retrieval.
- Trình bày tất cả bản ghi hội thảo liên quan.
- Mỗi kết quả phải là một block riêng.
- Tên hội thảo phải nằm trên một dòng riêng.
- Location, Deadline, Event date và URL phải nằm trên các dòng riêng.
- Không tự suy diễn dữ liệu còn thiếu.
- Tên hội thảo có thể được khớp từ name, title, conference_name, event_name hoặc acronym.
- Địa điểm có thể được khớp từ location, venue, place hoặc city + country.
- Chủ đề/lĩnh vực có thể được khớp từ topics, topic, fields, field, categories, category, areas, area, subjects, subject, keywords hoặc keyword.
- Deadline có thể được khớp từ deadline, submission_deadline, paper_deadline, cfp_deadline hoặc close_date.
- Ngày tổ chức có thể được khớp từ start_date, event_date, conference_date hoặc date.
- stored_status và temporal_status là hai khái niệm khác nhau.
- Không được hiểu stored_status="completed" là hội thảo đã kết thúc nếu ngày tháng không chứng minh điều đó.
- CFP text, source, trạng thái crawl và các trường nội bộ chỉ dùng để hiểu bản ghi; không tự động hiển thị nếu người dùng không hỏi.

Nếu liệt kê tạp chí:
- Chỉ sử dụng các bản ghi [J1], [J2], ... được cung cấp trong prompt.
- Các mã [J...] chỉ dùng để tham chiếu nội bộ; tuyệt đối không hiển thị chúng trong câu trả lời.
- Giữ nguyên thứ tự retrieval.
- Trình bày tất cả bản ghi tạp chí liên quan.
- Mỗi kết quả phải là một block riêng.
- Tên tạp chí phải nằm trên một dòng riêng.
- Publisher, Country, Quartile và URL phải nằm trên các dòng riêng.
- Không tự suy diễn quartile, publisher, country hoặc URL.
- Nếu quartile không được cung cấp thì bỏ dòng Quartile, không loại bản ghi và không kết luận bản ghi không đáp ứng quartile.
- Quartile chỉ được lấy từ trường quartile đã cung cấp trong retrieval context.
- Không suy ra quartile tổng thể từ categories, areas hoặc fields.
- Field/lĩnh vực có thể được khớp từ fields, field, categories, category, areas, area, subjects, subject, topics hoặc topic.
- Publisher có thể được khớp từ publisher, publisher_name, publisher_alt hoặc organization.
- Country có thể được khớp từ country, country_name hoặc nation.
- Các trường SJR, H-index, ISSN, rank, coverage và open access chỉ hiển thị nếu câu hỏi của người dùng cần chúng.

VỀ ĐỊNH DẠNG:
- Dùng heading và emoji theo mẫu trong SYSTEM PROMPT.
- Mỗi thuộc tính phải nằm trên một dòng riêng.
- Không ghép nhiều thuộc tính trên cùng một dòng.
- Không dùng "---" giữa các kết quả.
- Không dùng 🥇, 🔥, ⭐ hoặc nhãn đánh giá tương tự.
- Không hiển thị bất kỳ trường dữ liệu thiếu nào.
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