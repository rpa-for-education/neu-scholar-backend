// agents/fund/fund.prompt.js


// =====================================================
// CONFIG
// =====================================================

const MAX_HISTORY = 6;
const MAX_HISTORY_CHARS = 700;

const MAX_SUMMARY_CHARS = 500;


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


function joinValue(value) {
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


function firstArrayValue(...values) {
  for (const value of values) {
    const text =
      joinValue(value);

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
    [
      "true",
      "yes",
      "y",
      "1"
    ].includes(text)
  ) {
    return "Yes";
  }

  if (
    [
      "false",
      "no",
      "n",
      "0"
    ].includes(text)
  ) {
    return "No";
  }

  return "";
}


/*
 * Missing fields are omitted completely from
 * the internal retrieval context.
 *
 * This is safer than inserting "N/A" and asking
 * the LLM to remove it later.
 */
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


// =====================================================
// CANONICAL FIELD GETTERS
// =====================================================

function getTitle(fund) {
  return firstValue(
    fund?.opportunity_title,
    fund?.title,
    fund?.name,
    fund?.program_title,
    fund?.opportunity_name
  );
}


function getAgency(fund) {
  return firstValue(
    fund?.agency_name,
    fund?.agency,
    fund?.funding_agency,
    fund?.organization,
    fund?.sponsor,
    fund?.top_level_agency_name
  );
}


function getTopLevelAgency(fund) {
  return firstValue(
    fund?.top_level_agency_name,
    fund?.parent_agency_name,
    fund?.department
  );
}


function getDeadline(fund) {
  return firstValue(
    fund?.close_date,
    fund?.deadline,
    fund?.application_deadline,
    fund?.submission_deadline
  );
}


/*
 * IMPORTANT:
 *
 * Total/program funding and award ceiling are
 * different concepts.
 *
 * Do NOT use award_ceiling as a fallback here.
 */
function getFundingAmount(fund) {
  return firstValue(
    fund?.funding_amount,
    fund?.estimated_total_program_funding,
    fund?.amount,
    fund?.total_funding
  );
}


function getAwardCeiling(fund) {
  return firstValue(
    fund?.award_ceiling,
    fund?.maximum_award,
    fund?.max_award
  );
}


function getAwardFloor(fund) {
  return firstValue(
    fund?.award_floor,
    fund?.minimum_award,
    fund?.min_award
  );
}


function getLink(fund) {
  return firstValue(
    fund?.url,
    fund?.link,
    fund?.opportunity_url,
    fund?.additional_info_url,
    fund?.website,
    fund?.homepage,
    fund?.[
      "OPPORTUNITY URL"
    ],
    fund?.[
      "LINK TO ADDITIONAL INFORMATION"
    ]
  );
}


function getSummary(fund) {
  return truncate(
    firstValue(
      fund?.summary_description,
      fund?.description,
      fund?.summary,
      fund?.text,
      fund?.funding_category_description,
      fund?.category_explanation
    ),
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


  /*
   * Portal may include the current question
   * as the final user message in history.
   *
   * Remove it to avoid duplication.
   */
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


  /*
   * IMPORTANT:
   *
   * Do NOT slice here.
   *
   * fund.search.js / fund.service.js owns topk.
   * Every retrieved record passed to this prompt
   * should remain visible to the LLM.
   */
  const items =
    funds.map(
      (
        fund,
        index
      ) => {

        const id =
          `F${index + 1}`;


        // -----------------------------------------------
        // TITLE
        // -----------------------------------------------

        const title =
          getTitle(fund) ||
          "Untitled funding opportunity";


        // -----------------------------------------------
        // AGENCY
        // -----------------------------------------------

        const agency =
          getAgency(fund);


        const topLevelAgency =
          getTopLevelAgency(fund);


        const agencyCode =
          firstValue(
            fund?.agency_code,
            fund?.agency_id
          );


        // -----------------------------------------------
        // OPPORTUNITY IDENTIFIERS
        // -----------------------------------------------

        const opportunityId =
          firstValue(
            fund?.opportunity_id,
            fund?.id,
            fund?.opportunity_identifier
          );


        const opportunityNumber =
          firstValue(
            fund?.opportunity_number,
            fund?.funding_opportunity_number,
            fund?.foa_number,
            fund?.notice_number
          );


        const opportunityStatus =
          firstValue(
            fund?.opportunity_status,
            fund?.status
          );


        // -----------------------------------------------
        // CATEGORY / RESEARCH FIELD
        // -----------------------------------------------

        const category =
          firstArrayValue(
            fund?.category,
            fund?.funding_categories,
            fund?.funding_category,
            fund?.categories,
            fund?.research_area,
            fund?.research_areas,
            fund?.topics,
            fund?.keywords
          );


        const categoryDescription =
          truncate(
            firstValue(
              fund?.funding_category_description,
              fund?.category_explanation,
              fund?.category_description
            ),
            MAX_SUMMARY_CHARS
          );


        const assistanceListings =
          firstArrayValue(
            fund?.opportunity_assistance_listings,
            fund?.assistance_listings,
            fund?.assistance_listing,
            fund?.cfda_numbers
          );


        // -----------------------------------------------
        // FUNDING
        // -----------------------------------------------

        const funding =
          getFundingAmount(fund);


        const awardCeiling =
          getAwardCeiling(fund);


        const awardFloor =
          getAwardFloor(fund);


        const expectedAwards =
          firstValue(
            fund?.expected_number_of_awards,
            fund?.expected_awards,
            fund?.number_of_awards
          );


        const fundingInstruments =
          firstArrayValue(
            fund?.funding_instruments,
            fund?.funding_instrument,
            fund?.instrument_type
          );


        // -----------------------------------------------
        // APPLICANT / ELIGIBILITY
        // -----------------------------------------------

        const applicantTypes =
          firstArrayValue(
            fund?.applicant_types,
            fund?.applicant_type,
            fund?.eligible_applicants,
            fund?.eligibility_types
          );


        const eligibility =
          truncate(
            firstValue(
              fund?.applicant_eligibility_description,
              fund?.applicant_description,
              fund?.eligibility_description,
              fund?.eligibility
            ),
            MAX_SUMMARY_CHARS
          );


        const costSharing =
          booleanValue(
            fund?.is_cost_sharing ??
            fund?.cost_sharing
          );


        // -----------------------------------------------
        // DATES
        // -----------------------------------------------

        const postDate =
          firstValue(
            fund?.post_date,
            fund?.posted_date,
            fund?.publication_date
          );


        /*
         * Real deadline only.
         *
         * forecasted_close_date is kept separately below.
         */
        const deadline =
          getDeadline(fund);


        const deadlineDescription =
          truncate(
            firstValue(
              fund?.close_date_description,
              fund?.deadline_description,
              fund?.submission_deadline_description
            ),
            MAX_SUMMARY_CHARS
          );


        const archiveDate =
          firstValue(
            fund?.archive_date
          );


        const fiscalYear =
          firstValue(
            fund?.fiscal_year,
            fund?.fy
          );


        // -----------------------------------------------
        // FORECAST
        // -----------------------------------------------

        const isForecast =
          booleanValue(
            fund?.is_forecast ??
            fund?.forecast
          );


        const forecastedPostDate =
          firstValue(
            fund?.forecasted_post_date
          );


        const forecastedCloseDate =
          firstValue(
            fund?.forecasted_close_date
          );


        const forecastedAwardDate =
          firstValue(
            fund?.forecasted_award_date
          );


        const forecastedProjectStartDate =
          firstValue(
            fund?.forecasted_project_start_date
          );


        // -----------------------------------------------
        // CONTACT
        // -----------------------------------------------

        const agencyContact =
          truncate(
            firstValue(
              fund?.agency_contact_description,
              fund?.agency_contact,
              fund?.contact_description,
              fund?.contact_name
            ),
            MAX_SUMMARY_CHARS
          );


        const agencyEmail =
          firstValue(
            fund?.agency_email_address,
            fund?.agency_email,
            fund?.contact_email,
            fund?.email
          );


        // -----------------------------------------------
        // SOURCE / URL / DESCRIPTION
        // -----------------------------------------------

        const source =
          firstValue(
            fund?.source,
            fund?.data_source,
            fund?.provider
          );


        const link =
          getLink(fund);


        const additionalInfoUrl =
          firstValue(
            fund?.additional_info_url
          );


        const summary =
          getSummary(fund);


        // -----------------------------------------------
        // INTERNAL RETRIEVAL CONTEXT
        //
        // Missing fields are omitted completely.
        // -----------------------------------------------

        const fields = [
          contextField(
            "Title",
            title
          ),

          contextField(
            "Agency",
            agency
          ),

          contextField(
            "Top-level agency",
            topLevelAgency
          ),

          contextField(
            "Agency code",
            agencyCode
          ),

          contextField(
            "Opportunity ID",
            opportunityId
          ),

          contextField(
            "Opportunity number",
            opportunityNumber
          ),

          contextField(
            "Opportunity status",
            opportunityStatus
          ),

          contextField(
            "Category",
            category
          ),

          contextField(
            "Category description",
            categoryDescription
          ),

          contextField(
            "Assistance listings",
            assistanceListings
          ),

          contextField(
            "Total/program funding",
            funding
          ),

          contextField(
            "Award ceiling",
            awardCeiling
          ),

          contextField(
            "Award floor",
            awardFloor
          ),

          contextField(
            "Expected awards",
            expectedAwards
          ),

          contextField(
            "Funding instruments",
            fundingInstruments
          ),

          contextField(
            "Applicant types",
            applicantTypes
          ),

          contextField(
            "Eligibility",
            eligibility
          ),

          contextField(
            "Cost sharing",
            costSharing
          ),

          contextField(
            "Post date",
            postDate
          ),

          contextField(
            "Deadline",
            deadline
          ),

          contextField(
            "Deadline description",
            deadlineDescription
          ),

          contextField(
            "Archive date",
            archiveDate
          ),

          contextField(
            "Fiscal year",
            fiscalYear
          ),

          contextField(
            "Is forecast",
            isForecast
          ),

          contextField(
            "Forecasted post date",
            forecastedPostDate
          ),

          contextField(
            "Forecasted close date",
            forecastedCloseDate
          ),

          contextField(
            "Forecasted award date",
            forecastedAwardDate
          ),

          contextField(
            "Forecasted project start date",
            forecastedProjectStartDate
          ),

          contextField(
            "Agency contact",
            agencyContact
          ),

          contextField(
            "Agency email",
            agencyEmail
          ),

          contextField(
            "Source",
            source
          ),

          contextField(
            "Link",
            link
          ),

          contextField(
            "Additional info URL",
            additionalInfoUrl
          ),

          contextField(
            "Summary",
            summary
          )
        ].filter(Boolean);


        return [
          `[${id}]`,
          ...fields
        ].join("\n");
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
- Không tạo thêm quỹ, chương trình, agency, funding, deadline, URL, eligibility hoặc thuộc tính không được cung cấp.
- Giữ nguyên tên chính thức của chương trình hoặc cơ hội tài trợ.
- Không tự suy diễn dữ liệu từ tên chương trình.
- Các mã [F1], [F2], [F3], ... chỉ dùng nội bộ để xác định đúng bản ghi nguồn.
- Tuyệt đối không hiển thị mã [F1], [F2], [F3], ... cho người dùng.
- Không suy diễn đơn vị tiền tệ nếu dữ liệu không nêu rõ.
- Không gọi funding là "lớn", "cao", "tốt" hoặc tương tự nếu dữ liệu không cung cấp cơ sở so sánh.
- Không tự tạo lý do phù hợp nếu dữ liệu không hỗ trợ.
- Không tự tạo thêm kết quả ngoài danh sách được cung cấp.

PHÂN BIỆT CÁC TRƯỜNG KINH PHÍ:
- Total/program funding là tổng kinh phí của chương trình hoặc cơ hội nếu dữ liệu có cung cấp.
- Award ceiling là mức tài trợ tối đa cho một award nếu dữ liệu có cung cấp.
- Award floor là mức tài trợ tối thiểu cho một award nếu dữ liệu có cung cấp.
- Không dùng Award ceiling thay cho Total/program funding.
- Không dùng Award floor thay cho Total/program funding.
- Không cộng, chia hoặc suy diễn mức tài trợ trung bình từ các trường trên nếu người dùng không yêu cầu và dữ liệu không đủ.
- Không tự suy diễn đơn vị tiền tệ.

DEADLINE, STATUS VÀ FORECAST:
- Opportunity status, Deadline và Is forecast là các thuộc tính khác nhau.
- Không tự đồng nhất forecasted_close_date với close_date thực tế.
- Forecasted close date chỉ là ngày dự kiến.
- Không khẳng định cơ hội "còn mở", "đang mở" hoặc "đã đóng" nếu dữ liệu status/deadline không đủ để xác định.
- Nếu Opportunity status có giá trị cụ thể, có thể sử dụng đúng giá trị đó.
- Nếu người dùng hỏi thời hạn, ưu tiên Deadline thực tế.
- Forecast dates chỉ sử dụng khi phù hợp và phải thể hiện rõ đó là ngày dự kiến.
- Archive date không phải deadline nộp hồ sơ.
- Post date không phải deadline nộp hồ sơ.

ELIGIBILITY:
- Applicant types mô tả nhóm đối tượng có thể nộp nếu dữ liệu có cung cấp.
- Eligibility mô tả điều kiện đủ tư cách nếu dữ liệu có cung cấp.
- Không suy diễn rằng chính người dùng đủ điều kiện chỉ vì một bản ghi có Applicant types hoặc Eligibility.
- Không suy diễn rằng người dùng không đủ điều kiện khi dữ liệu eligibility bị thiếu.
- Nếu người dùng hỏi "tôi có đủ điều kiện không?", chỉ đối chiếu những điều kiện được cung cấp với thông tin người dùng đã nêu rõ trong hội thoại.
- Nếu thiếu dữ liệu để xác nhận eligibility thì nói ngắn gọn rằng chưa đủ dữ liệu để kết luận.

QUY TẮC DỮ LIỆU THIẾU:
- Trường không xuất hiện trong RETRIEVED FUNDS có nghĩa là hệ thống không có dữ liệu cho trường đó.
- Không tự điền, suy đoán hoặc suy diễn giá trị còn thiếu.
- Nếu một thuộc tính không có dữ liệu thì bỏ toàn bộ thuộc tính đó khỏi phần trình bày.
- Không được vì thiếu một hoặc nhiều thuộc tính mà bỏ cả bản ghi.
- Thiếu dữ liệu KHÔNG đồng nghĩa với việc bản ghi không đáp ứng điều kiện.
- Thiếu Funding không có nghĩa là cơ hội không có kinh phí.
- Thiếu Deadline không có nghĩa là cơ hội đã đóng.
- Thiếu Agency không có nghĩa là cơ hội không thuộc agency được yêu cầu.
- Thiếu Eligibility không có nghĩa là người dùng không đủ điều kiện.
- Thiếu Status không có nghĩa là cơ hội đã đóng.
- Chỉ loại một bản ghi khi dữ liệu cụ thể của bản ghi chứng minh rằng nó trái với điều kiện bắt buộc của người dùng.
- Nếu tất cả các kết quả liên quan đều thiếu một thuộc tính mà người dùng yêu cầu, chỉ nói một câu ngắn rằng dữ liệu hiện có chưa đủ để xác nhận thuộc tính đó; sau đó vẫn trình bày các kết quả liên quan.
- Không lặp lại lời giải thích về dữ liệu thiếu ở cuối câu trả lời.
- Không viết disclaimer dài về dữ liệu thiếu.
- Tuyệt đối không hiển thị "N/A", "null" hoặc "undefined".

QUY TẮC SỐ LƯỢNG KẾT QUẢ:
- Phải xét tất cả các bản ghi RETRIEVED FUNDS được cung cấp trong prompt.
- Nếu hệ thống cung cấp N bản ghi liên quan thì phải trình bày đủ N bản ghi, trừ bản ghi có dữ liệu cụ thể chứng minh rằng nó trái với điều kiện bắt buộc của người dùng.
- Không tự rút gọn số lượng kết quả chỉ để làm câu trả lời ngắn hơn.
- Không được chỉ chọn một phần kết quả khi hệ thống đã cung cấp nhiều kết quả liên quan.
- Thiếu Agency, Funding, Deadline, Link, Summary hoặc thuộc tính khác không phải là lý do để bỏ bản ghi.
- Không thay thế các bản ghi thiếu thuộc tính bằng một câu nhận xét chung.

THỨ TỰ KẾT QUẢ:
- Giữ nguyên thứ tự các kết quả mà RETRIEVED FUNDS cung cấp.
- Không tự xếp hạng lại dựa trên funding amount, deadline, agency hoặc thuộc tính khác.
- Không chuyển thứ tự retrieval thành các nhãn đánh giá định tính.
- Không dùng các nhãn như "Top phù hợp nhất", "Nổi bật", "Đáng cân nhắc", "Tốt nhất", "Hàng đầu" hoặc "Phù hợp nhất" nếu dữ liệu không cung cấp căn cứ trực tiếp.
- Không giải thích cho người dùng về cơ chế retrieval hoặc ranking nội bộ.

ÁNH XẠ TRƯỜNG DỮ LIỆU:
- Title: opportunity_title, title, name, program_title, opportunity_name.
- Agency: agency_name, agency, funding_agency, organization, sponsor; top_level_agency_name chỉ là fallback khi không có agency cụ thể.
- Top-level agency: top_level_agency_name, parent_agency_name, department.
- Agency code: agency_code, agency_id.
- Opportunity ID: opportunity_id, id, opportunity_identifier.
- Opportunity number: opportunity_number, funding_opportunity_number, foa_number, notice_number.
- Opportunity status: opportunity_status, status.
- Category/lĩnh vực: category, funding_categories, funding_category, categories, research_area, research_areas, topics, keywords.
- Total/program funding: funding_amount, estimated_total_program_funding, amount, total_funding.
- Award ceiling: award_ceiling, maximum_award, max_award.
- Award floor: award_floor, minimum_award, min_award.
- Expected awards: expected_number_of_awards, expected_awards, number_of_awards.
- Funding instruments: funding_instruments, funding_instrument, instrument_type.
- Applicant types: applicant_types, applicant_type, eligible_applicants, eligibility_types.
- Eligibility: applicant_eligibility_description, applicant_description, eligibility_description, eligibility.
- Deadline: close_date, deadline, application_deadline, submission_deadline.
- Forecasted close date là trường forecast riêng, không phải fallback mặc định của Deadline.
- Post date: post_date, posted_date, publication_date.
- URL: url, link, opportunity_url, additional_info_url, website, homepage.
- Summary: summary_description, description, summary, text, funding_category_description, category_explanation.
- Không tự tạo giá trị khi các trường tương ứng đều không có dữ liệu.

PHONG CÁCH TRẢ LỜI:
- Trả lời bằng tiếng Việt.
- Đi thẳng vào nội dung người dùng cần.
- Có thể dùng một câu mở đầu ngắn khi thực sự cần thiết.
- Không lặp lại nguyên văn câu hỏi của người dùng một cách máy móc.
- Không viết lời chào.
- Trình bày đầy đủ số lượng kết quả trước; sự ngắn gọn chỉ áp dụng cho nội dung của từng kết quả.
- Có thể sử dụng Markdown, heading và emoji vừa phải để tăng khả năng đọc.
- Không dùng emoji để thể hiện thứ hạng hoặc đánh giá chất lượng.
- Không hiển thị ID nội bộ [F1], [F2], ...
- Không viết disclaimer dài về dữ liệu bị thiếu.

ĐỊNH DẠNG QUỸ TÀI TRỢ:
- Nếu có kết quả, dùng tiêu đề:
  "## 💰 Cơ hội tài trợ liên quan"
- Mỗi cơ hội phải là một block riêng.
- Đánh số đầy đủ theo đúng thứ tự retrieval.
- Tên chương trình hoặc cơ hội tài trợ nằm trên một dòng riêng và được in đậm.
- Mỗi thuộc tính nằm trên một dòng riêng bên dưới tên.
- Giữa hai cơ hội có một dòng trống.
- Không dùng "---" để phân cách.

Định dạng cơ bản:

### 1. **Tên chương trình hoặc cơ hội tài trợ**

- 🏢 **Cơ quan tài trợ:** Agency
- 💵 **Tổng kinh phí chương trình:** Total/program funding
- 🎯 **Mức tài trợ tối đa:** Award ceiling
- 📅 **Hạn nộp:** Deadline
- 🔎 **Liên kết:** URL

QUY TẮC ĐỊNH DẠNG:
- Chỉ hiển thị dòng có dữ liệu thực tế.
- Agency không có dữ liệu → bỏ dòng 🏢.
- Total/program funding không có dữ liệu → bỏ dòng 💵.
- Award ceiling không có dữ liệu → bỏ dòng 🎯.
- Deadline không có dữ liệu → bỏ dòng 📅.
- Link không có dữ liệu → bỏ dòng 🔎.
- Không ghép nhiều thuộc tính trên cùng một dòng.
- Không hiển thị mã [F...].
- Không dùng "---" giữa các kết quả.
- Không dùng 🥇, 🔥, ⭐ hoặc biểu tượng tương tự để thể hiện thứ hạng hay đánh giá.

CÁC THUỘC TÍNH BỔ SUNG:
- Top-level agency, Agency code, Opportunity ID, Opportunity number, Opportunity status, Category, Category description, Assistance listings, Award floor, Expected awards, Funding instruments, Applicant types, Eligibility, Cost sharing, Post date, Deadline description, Archive date, Fiscal year, Forecast information, Agency contact, Agency email và Source là dữ liệu hỗ trợ.
- Không bắt buộc hiển thị tất cả các trường bổ sung trong mọi câu trả lời.
- Khi người dùng hỏi trực tiếp về một trường bổ sung, phải sử dụng trường đó nếu dữ liệu có cung cấp.
- Khi một trường bổ sung trực tiếp quyết định việc kết quả có đáp ứng yêu cầu hay không, phải sử dụng trường đó để đánh giá.
- Không bỏ cả bản ghi chỉ vì một trường bổ sung không có dữ liệu.

SUMMARY:
- Summary là dữ liệu hỗ trợ để hiểu nội dung và chủ đề của cơ hội tài trợ.
- Chỉ sử dụng Summary khi nó trực tiếp giúp trả lời câu hỏi của người dùng.
- Nếu hiển thị Summary, viết thành một dòng riêng:
  - 📝 **Nội dung:** tóm tắt ngắn
- Không biến Summary thành nhận xét chủ quan về mức độ phù hợp.

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
Không có cơ hội tài trợ nào được hệ thống truy xuất cho câu hỏi hiện tại.
`.trim());
  }


  // ===================================================
  // 3. CURRENT QUESTION
  // ===================================================

  sections.push(`
=== CURRENT QUESTION ===
${currentQuestion || "(empty)"}

=== YÊU CẦU TRẢ LỜI ===
Trả lời trực tiếp câu hỏi hiện tại dựa trên CONVERSATION HISTORY và RETRIEVED FUNDS.

Nếu đây là câu hỏi tiếp nối:
- Kế thừa các điều kiện còn hiệu lực từ hội thoại trước.
- Điều kiện mới thay thế điều kiện cũ cùng loại.
- Không tự thêm điều kiện chưa từng được người dùng nêu.

QUAN TRỌNG VỀ SỐ LƯỢNG:
- Phải xét tất cả các bản ghi RETRIEVED FUNDS được cung cấp.
- Nếu có N bản ghi liên quan thì phải trình bày đủ N bản ghi, trừ khi dữ liệu cụ thể chứng minh rằng bản ghi trái với điều kiện bắt buộc của người dùng.
- Không tự rút gọn danh sách.
- Thiếu một thuộc tính không phải là lý do để bỏ cả bản ghi.

QUAN TRỌNG VỀ DỮ LIỆU THIẾU:
- Trường không xuất hiện trong bản ghi nghĩa là hệ thống không có dữ liệu cho trường đó.
- Không tự suy diễn giá trị còn thiếu.
- Không hiển thị "N/A", "null" hoặc "undefined".
- Thiếu dữ liệu không phải là bằng chứng phủ định.
- Chỉ loại bản ghi khi có dữ liệu cụ thể chứng minh rằng nó trái với điều kiện bắt buộc.

QUAN TRỌNG VỀ FUNDING:
- Total/program funding và Award ceiling là hai khái niệm khác nhau.
- Không dùng Award ceiling thay cho Total/program funding.
- Không suy diễn đơn vị tiền tệ.
- Nếu người dùng hỏi "mức tài trợ tối đa", dùng Award ceiling.
- Nếu người dùng hỏi "tổng kinh phí chương trình", dùng Total/program funding.
- Nếu chỉ có một trong hai trường, không biến nó thành trường còn lại.

QUAN TRỌNG VỀ DEADLINE:
- Deadline thực tế và Forecasted close date là hai khái niệm khác nhau.
- Không trình bày Forecasted close date như deadline chính thức nếu dữ liệu chỉ cho biết đó là forecast.
- Post date và Archive date không phải Deadline.
- Không tự kết luận cơ hội đang mở hoặc đã đóng khi dữ liệu không đủ.

KHI NGƯỜI DÙNG HỎI THEO ĐIỀU KIỆN:
- Theo agency → xét Agency, Top-level agency và Agency code.
- Theo lĩnh vực/chủ đề → xét Title, Category, Category description, Summary và Assistance listings.
- Theo tổng kinh phí → xét Total/program funding.
- Theo mức tài trợ tối đa/tối thiểu → xét Award ceiling/Award floor.
- Theo đối tượng đủ điều kiện → xét Applicant types và Eligibility.
- Theo thời hạn → xét Deadline và Deadline description; chỉ dùng forecast dates khi phù hợp.
- Theo trạng thái → xét Opportunity status và Is forecast.
- Theo loại hình tài trợ → xét Funding instruments.
- Theo chương trình cụ thể → xét Opportunity ID, Opportunity number và Title.
- Không sử dụng một trường bị thiếu làm bằng chứng phủ định.

VỀ DỮ LIỆU:
- Chỉ sử dụng các bản ghi [F1], [F2], ... trong RETRIEVED FUNDS làm nguồn dữ liệu thực tế về cơ hội tài trợ.
- Các mã [F...] chỉ dùng nội bộ; tuyệt đối không hiển thị chúng.
- Giữ nguyên thứ tự retrieval.
- Không tự tạo thêm cơ hội tài trợ.
- Không tự bổ sung thông tin còn thiếu.
- Không tự suy diễn eligibility.
- Không tự tạo lý do phù hợp nếu dữ liệu không hỗ trợ.
- Không tự đánh giá hoặc xếp hạng lại các cơ hội.

VỀ ĐỊNH DẠNG:
- Khi có kết quả, dùng tiêu đề "## 💰 Cơ hội tài trợ liên quan".
- Mỗi cơ hội phải là một block riêng.
- Tên mỗi cơ hội phải nằm trên một dòng riêng.
- Mỗi thuộc tính phải nằm trên một dòng riêng.
- Chỉ hiển thị thuộc tính có dữ liệu.
- Không ghép nhiều thuộc tính trên cùng một dòng.
- Không dùng "---" giữa các kết quả.
- Không dùng 🥇, 🔥, ⭐ hoặc nhãn đánh giá tương tự.
- Không mô tả cơ chế retrieval hoặc ranking nội bộ.

Nếu RETRIEVED FUNDS không có kết quả:
- Nói ngắn gọn rằng chưa tìm thấy cơ hội phù hợp trong dữ liệu được truy xuất.
- Không biến điều này thành khẳng định rằng cơ hội đó không tồn tại ngoài hệ thống.
- Không tự tạo thông tin để bù vào.

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