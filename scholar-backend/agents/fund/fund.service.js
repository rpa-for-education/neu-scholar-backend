// agents/fund/fund.service.js

import {
  runFundSearch
} from "./fund.agent.js";

import {
  normalizeHistory
} from "../shared/memory.js";

import {
  rewriteQuery
} from "../shared/queryRewriter.js";


// =====================================================
// CONFIG
// =====================================================

const MAX_RETURN = 5;


// =====================================================
// BASIC UTILS
// =====================================================

function hasValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "string") {
    const text =
      value.trim().toLowerCase();

    return (
      text !== "" &&
      text !== "n/a" &&
      text !== "na" &&
      text !== "null" &&
      text !== "undefined"
    );
  }

  return true;
}


function normalizeText(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (Array.isArray(value)) {
    return value
      .map(normalizeText)
      .filter(Boolean)
      .join(", ");
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeLower(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}


function firstValue(...values) {
  for (const value of values) {
    if (hasValue(value)) {
      return value;
    }
  }

  return "";
}


function safeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}


// =====================================================
// FUND FIELD GETTERS
// =====================================================

function getTitle(fund = {}) {
  return normalizeText(
    firstValue(
      fund?.opportunity_title,
      fund?.title,
      fund?.name,
      fund?.program_title,
      fund?.opportunity_name,
      fund?.["OPPORTUNITY TITLE"]
    )
  );
}


function getAgency(fund = {}) {
  return normalizeText(
    firstValue(
      fund?.agency_name,
      fund?.agency,
      fund?.funding_agency,
      fund?.organization,
      fund?.sponsor,
      fund?.top_level_agency_name,
      fund?.["AGENCY NAME"]
    )
  );
}


function getTopLevelAgency(fund = {}) {
  return normalizeText(
    firstValue(
      fund?.top_level_agency_name,
      fund?.parent_agency_name,
      fund?.department
    )
  );
}


function getAgencyCode(fund = {}) {
  return normalizeText(
    firstValue(
      fund?.agency_code,
      fund?.agency_id
    )
  );
}


function getOpportunityId(fund = {}) {
  return normalizeText(
    firstValue(
      fund?.opportunity_id,
      fund?.opportunity_identifier
    )
  );
}


function getOpportunityNumber(fund = {}) {
  return normalizeText(
    firstValue(
      fund?.opportunity_number,
      fund?.funding_opportunity_number,
      fund?.foa_number,
      fund?.notice_number
    )
  );
}


function getOpportunityStatus(fund = {}) {
  return normalizeText(
    firstValue(
      fund?.opportunity_status,
      fund?.status
    )
  );
}


function getCategory(fund = {}) {
  return normalizeText(
    firstValue(
      fund?.funding_categories,
      fund?.funding_category,
      fund?.category,
      fund?.categories,
      fund?.research_area,
      fund?.research_areas,
      fund?.topics,
      fund?.keywords
    )
  );
}


function getCategoryDescription(
  fund = {}
) {
  return normalizeText(
    firstValue(
      fund?.funding_category_description,
      fund?.category_explanation,
      fund?.category_description
    )
  );
}


function getAssistanceListings(
  fund = {}
) {
  return normalizeText(
    firstValue(
      fund?.opportunity_assistance_listings,
      fund?.assistance_listings,
      fund?.assistance_listing,
      fund?.cfda_numbers
    )
  );
}


function getFundingInstruments(
  fund = {}
) {
  return normalizeText(
    firstValue(
      fund?.funding_instruments,
      fund?.funding_instrument,
      fund?.instrument_type
    )
  );
}


function getApplicantTypes(
  fund = {}
) {
  return normalizeText(
    firstValue(
      fund?.applicant_types,
      fund?.applicant_type,
      fund?.eligible_applicants,
      fund?.eligibility_types
    )
  );
}


function getEligibility(
  fund = {}
) {
  return normalizeText(
    firstValue(
      fund?.applicant_eligibility_description,
      fund?.applicant_description,
      fund?.eligibility_description,
      fund?.eligibility
    )
  );
}


function getSummary(fund = {}) {
  return normalizeText(
    firstValue(
      fund?.summary_description,
      fund?.description,
      fund?.text,
      fund?.summary,
      fund?.["FUNDING DESCRIPTION"],
      fund?.additional_info_url_description,
      fund?.funding_category_description,
      fund?.category_explanation
    )
  );
}


function getDeadline(fund = {}) {
  return normalizeText(
    firstValue(
      fund?.close_date,
      fund?.deadline,
      fund?.application_deadline,
      fund?.submission_deadline,
      fund?.["ESTIMATED APPLICATION DUE DATE"],
      fund?.forecasted_close_date
    )
  );
}


function getPostDate(fund = {}) {
  return normalizeText(
    firstValue(
      fund?.post_date,
      fund?.posted_date,
      fund?.publication_date
    )
  );
}


function getArchiveDate(fund = {}) {
  return normalizeText(
    firstValue(
      fund?.archive_date
    )
  );
}


/*
 * IMPORTANT:
 *
 * Canonical "amount" means total/program funding
 * when such information is available.
 *
 * Award ceiling and award floor are separate fields.
 */
function getAmount(fund = {}) {
  return firstValue(
    fund?.funding_amount,
    fund?.estimated_total_program_funding,
    fund?.amount,
    fund?.total_funding,
    fund?.["ESTIMATED TOTAL FUNDING"]
  );
}


function getAwardCeiling(fund = {}) {
  return firstValue(
    fund?.award_ceiling,
    fund?.maximum_award,
    fund?.max_award
  );
}


function getAwardFloor(fund = {}) {
  return firstValue(
    fund?.award_floor,
    fund?.minimum_award,
    fund?.min_award
  );
}


function getExpectedAwards(fund = {}) {
  return firstValue(
    fund?.expected_number_of_awards,
    fund?.expected_awards,
    fund?.number_of_awards
  );
}


function getUrl(fund = {}) {
  return normalizeText(
    firstValue(
      fund?.url,
      fund?.link,
      fund?.additional_info_url,
      fund?.opportunity_url,
      fund?.website,
      fund?.homepage,
      fund?.["LINK TO ADDITIONAL INFORMATION"],
      fund?.["OPPORTUNITY URL"],
      fund?.["URL"]
    )
  );
}


// =====================================================
// SEARCHABLE TEXT
// =====================================================

function fundSearchText(fund = {}) {
  return normalizeLower(
    [
      getTitle(fund),

      getAgency(fund),
      getTopLevelAgency(fund),
      getAgencyCode(fund),

      getOpportunityId(fund),
      getOpportunityNumber(fund),
      getOpportunityStatus(fund),

      getCategory(fund),
      getCategoryDescription(fund),
      getAssistanceListings(fund),

      getFundingInstruments(fund),

      getApplicantTypes(fund),
      getEligibility(fund),

      getSummary(fund),

      fund?.source
    ]
      .filter(hasValue)
      .join(" ")
  );
}


// =====================================================
// AMOUNT
// =====================================================

function parseAmount(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }


  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }


  const text =
    normalizeLower(value)
      .replace(/,/g, "");


  if (!text) {
    return 0;
  }


  const match =
    text.match(
      /\d+(?:\.\d+)?/
    );


  if (!match) {
    return 0;
  }


  const number =
    Number(match[0]);


  if (!Number.isFinite(number)) {
    return 0;
  }


  if (
    /\b(billion|bn)\b/.test(text)
  ) {
    return number * 1e9;
  }


  if (
    /\b(million|mn)\b/.test(text) ||
    /\d+(?:\.\d+)?m\b/.test(text)
  ) {
    return number * 1e6;
  }


  if (
    /\b(thousand)\b/.test(text) ||
    /\d+(?:\.\d+)?k\b/.test(text)
  ) {
    return number * 1e3;
  }


  return number;
}


function formatMoney(
  amount,
  amountNum
) {
  const raw =
    normalizeText(amount);


  /*
   * Preserve currency if explicitly stored.
   *
   * Never infer currency from agency/country.
   */
  if (
    raw &&
    /[$€£¥₫]|usd|eur|gbp|vnd|đồng|dollar/i
      .test(raw)
  ) {
    return raw;
  }


  const num =
    safeNumber(
      amountNum,
      parseAmount(amount)
    );


  if (!num) {
    return raw;
  }


  return num.toLocaleString(
    "en-US"
  );
}


// =====================================================
// NORMALIZE FUND
//
// IMPORTANT:
//
// Preserve complete source payload.
//
// Canonical aliases are added for downstream use,
// but source fields are not destroyed.
// =====================================================

function normalizeFund(
  result,
  index
) {
  const payload =
    result?.payload ||
    result ||
    {};


  const title =
    getTitle(payload);

  const agency =
    getAgency(payload);

  const topLevelAgency =
    getTopLevelAgency(
      payload
    );

  const agencyCode =
    getAgencyCode(
      payload
    );

  const opportunityId =
    getOpportunityId(
      payload
    );

  const opportunityNumber =
    getOpportunityNumber(
      payload
    );

  const opportunityStatus =
    getOpportunityStatus(
      payload
    );

  const category =
    getCategory(payload);

  const categoryDescription =
    getCategoryDescription(
      payload
    );

  const assistanceListings =
    getAssistanceListings(
      payload
    );

  const fundingInstruments =
    getFundingInstruments(
      payload
    );

  const applicantTypes =
    getApplicantTypes(
      payload
    );

  const eligibility =
    getEligibility(
      payload
    );

  const summary =
    getSummary(payload);

  const deadline =
    getDeadline(payload);

  const postDate =
    getPostDate(payload);

  const archiveDate =
    getArchiveDate(payload);

  const amount =
    getAmount(payload);

  const amountNum =
    safeNumber(
      payload?.amount_num,
      parseAmount(amount)
    );

  const awardCeiling =
    getAwardCeiling(
      payload
    );

  const awardFloor =
    getAwardFloor(
      payload
    );

  const expectedAwards =
    getExpectedAwards(
      payload
    );

  const url =
    getUrl(payload);


  const rawScore =
    Number(
      result?.finalScore ??
      result?.score ??
      payload?.finalScore ??
      payload?.score ??
      0
    );


  /*
   * Hybrid scores can legitimately exceed 1.
   * Never clamp them to [0,1].
   */
  const score =
    Number.isFinite(rawScore)
      ? rawScore
      : 0;


  const normalized = {
    /*
     * Preserve complete Fund payload first.
     */
    ...payload,

    /*
     * Canonical fields.
     */
    title,

    opportunity_title:
      normalizeText(
        firstValue(
          payload?.opportunity_title,
          title
        )
      ),

    agency,

    agency_name:
      normalizeText(
        firstValue(
          payload?.agency_name,
          agency
        )
      ),

    top_level_agency_name:
      normalizeText(
        firstValue(
          payload?.top_level_agency_name,
          topLevelAgency
        )
      ),

    agency_code:
      normalizeText(
        firstValue(
          payload?.agency_code,
          agencyCode
        )
      ),

    opportunity_id:
      normalizeText(
        firstValue(
          payload?.opportunity_id,
          opportunityId
        )
      ),

    opportunity_number:
      normalizeText(
        firstValue(
          payload?.opportunity_number,
          opportunityNumber
        )
      ),

    opportunity_status:
      normalizeText(
        firstValue(
          payload?.opportunity_status,
          opportunityStatus
        )
      ),

    category:
      normalizeText(
        firstValue(
          payload?.category,
          category
        )
      ),

    funding_categories:
      normalizeText(
        firstValue(
          payload?.funding_categories,
          category
        )
      ),

    funding_category_description:
      normalizeText(
        firstValue(
          payload?.funding_category_description,
          categoryDescription
        )
      ),

    opportunity_assistance_listings:
      normalizeText(
        firstValue(
          payload?.opportunity_assistance_listings,
          assistanceListings
        )
      ),

    funding_instruments:
      normalizeText(
        firstValue(
          payload?.funding_instruments,
          fundingInstruments
        )
      ),

    applicant_types:
      normalizeText(
        firstValue(
          payload?.applicant_types,
          applicantTypes
        )
      ),

    applicant_eligibility_description:
      normalizeText(
        firstValue(
          payload?.applicant_eligibility_description,
          eligibility
        )
      ),

    summary_description:
      normalizeText(
        firstValue(
          payload?.summary_description,
          summary
        )
      ),

    text:
      normalizeText(
        firstValue(
          payload?.text,
          payload?.description,
          summary
        )
      ),

    deadline,

    close_date:
      normalizeText(
        firstValue(
          payload?.close_date,
          deadline
        )
      ),

    post_date:
      normalizeText(
        firstValue(
          payload?.post_date,
          postDate
        )
      ),

    archive_date:
      normalizeText(
        firstValue(
          payload?.archive_date,
          archiveDate
        )
      ),

    /*
     * Canonical total/program funding.
     */
    amount,

    amount_num:
      amountNum,

    /*
     * Do NOT fabricate source-specific fields.
     *
     * funding_amount and
     * estimated_total_program_funding remain empty
     * when they were absent from the source payload.
     */
    funding_amount:
      hasValue(
        payload?.funding_amount
      )
        ? payload.funding_amount
        : "",

    estimated_total_program_funding:
      hasValue(
        payload
          ?.estimated_total_program_funding
      )
        ? payload
            .estimated_total_program_funding
        : "",

    award_ceiling:
      awardCeiling,

    award_floor:
      awardFloor,

    expected_number_of_awards:
      firstValue(
        payload
          ?.expected_number_of_awards,
        expectedAwards
      ),

    url,

    score,

    _idx:
      index
  };


  return normalized;
}


function normalizeFunds(results) {
  if (!Array.isArray(results)) {
    return [];
  }

  return results.map(
    normalizeFund
  );
}


// =====================================================
// QUERY INTENT
// =====================================================

function hasToken(
  normalizedText,
  token
) {
  if (
    !normalizedText ||
    !token
  ) {
    return false;
  }

  const escaped =
    token.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  return new RegExp(
    `(^|\\s)${escaped}(?=\\s|$|[.,;:!?()])`,
    "i"
  ).test(
    normalizedText
  );
}


function isVietnamQuery(question) {
  const q =
    normalizeLower(question);

  return (
    q.includes("viet nam") ||
    q.includes("vietnam") ||
    q.includes("nafosted")
  );
}


function isUSQuery(question) {
  const q =
    normalizeLower(question);

  return (
    q.includes("hoa ky") ||
    q.includes("united states") ||
    hasToken(q, "usa") ||
    hasToken(q, "us") ||
    hasToken(q, "my")
  );
}


function isBasicResearchQuery(
  question
) {
  const q =
    normalizeLower(question);

  return (
    q.includes(
      "nghien cuu co ban"
    ) ||
    q.includes(
      "basic research"
    )
  );
}


function isNafostedFund(fund) {
  const text =
    fundSearchText(fund);

  return (
    text.includes("nafosted") ||
    text.includes(
      "quy phat trien khoa hoc"
    ) ||
    text.includes(
      "khoa hoc va cong nghe quoc gia"
    ) ||
    text.includes(
      "national foundation for science and technology development"
    )
  );
}


function isVietnamFund(fund) {
  const text =
    fundSearchText(fund);

  return (
    text.includes("vietnam") ||
    text.includes("viet nam") ||
    isNafostedFund(fund)
  );
}


// =====================================================
// DATE
// =====================================================

function safeTime(value) {
  if (!hasValue(value)) {
    return null;
  }

  const time =
    new Date(value)
      .getTime();

  return Number.isFinite(time)
    ? time
    : null;
}


function getDeadlineInfo(
  deadline
) {
  const time =
    safeTime(deadline);


  if (time === null) {
    return "";
  }


  const diffDays =
    (time - Date.now()) /
    86_400_000;


  if (diffDays < 0) {
    return "đã hết hạn";
  }


  if (diffDays <= 7) {
    return "deadline rất gần";
  }


  if (diffDays <= 30) {
    return "deadline sắp tới";
  }


  return "";
}


// =====================================================
// TOKENIZATION
// =====================================================

const STOP_WORDS =
  new Set([
    "cho",
    "toi",
    "tim",
    "kiem",
    "quy",
    "tai",
    "tro",
    "nguon",
    "ve",
    "cac",
    "nhung",
    "mot",
    "so",
    "cua",
    "va",
    "hoac",
    "o",
    "thuoc",
    "lien",
    "quan",
    "con",
    "thi",
    "sao",
    "nao",

    "fund",
    "funds",
    "grant",
    "grants",
    "funding",
    "find",
    "show",
    "give",
    "me",
    "about",
    "for",
    "the",
    "a",
    "an",
    "of",
    "and",
    "or",
    "in",
    "on"
  ]);


function tokenize(value) {
  return normalizeLower(value)
    .replace(
      /[^\p{L}\p{N}\s]/gu,
      " "
    )
    .split(/\s+/)
    .filter(
      token =>
        token.length >= 2 &&
        !STOP_WORDS.has(token) &&
        !/^20\d{2}$/.test(token)
    );
}


// =====================================================
// LEXICAL RELEVANCE
// =====================================================

function lexicalRelevance(
  fund,
  question
) {
  const tokens = [
    ...new Set(
      tokenize(question)
    )
  ];


  if (!tokens.length) {
    return 0;
  }


  const title =
    normalizeLower(
      getTitle(fund)
    );


  const agency =
    normalizeLower(
      [
        getAgency(fund),
        getTopLevelAgency(fund),
        getAgencyCode(fund)
      ]
        .filter(Boolean)
        .join(" ")
    );


  const category =
    normalizeLower(
      [
        getCategory(fund),
        getCategoryDescription(fund),
        getAssistanceListings(fund)
      ]
        .filter(Boolean)
        .join(" ")
    );


  const eligibility =
    normalizeLower(
      [
        getApplicantTypes(fund),
        getEligibility(fund)
      ]
        .filter(Boolean)
        .join(" ")
    );


  const summary =
    normalizeLower(
      getSummary(fund)
    );


  let titleHits = 0;
  let agencyHits = 0;
  let categoryHits = 0;
  let eligibilityHits = 0;
  let summaryHits = 0;


  for (const token of tokens) {
    if (title.includes(token)) {
      titleHits += 1;
    }

    if (agency.includes(token)) {
      agencyHits += 1;
    }

    if (category.includes(token)) {
      categoryHits += 1;
    }

    if (
      eligibility.includes(token)
    ) {
      eligibilityHits += 1;
    }

    if (summary.includes(token)) {
      summaryHits += 1;
    }
  }


  const count =
    tokens.length;


  return (
    (titleHits / count) * 4 +
    (agencyHits / count) * 3 +
    (categoryHits / count) * 3 +
    (eligibilityHits / count) * 1.5 +
    (summaryHits / count) * 2
  );
}


// =====================================================
// SECONDARY RELEVANCE
//
// fund.search.js owns the primary retrieval/ranking.
//
// This layer is intentionally modest and is used only
// as a tie-breaker after search score.
// =====================================================

function relevanceScore(
  fund,
  question
) {
  const q =
    normalizeLower(question);

  const text =
    fundSearchText(fund);


  let relevance =
    lexicalRelevance(
      fund,
      question
    );


  // ---------------------------------------------------
  // NAFOSTED
  // ---------------------------------------------------

  if (
    q.includes("nafosted") &&
    isNafostedFund(fund)
  ) {
    relevance += 1;
  }


  // ---------------------------------------------------
  // VIETNAM
  // ---------------------------------------------------

  if (
    isVietnamQuery(q) &&
    isVietnamFund(fund)
  ) {
    relevance += 0.5;
  }


  // ---------------------------------------------------
  // US
  // ---------------------------------------------------

  if (isUSQuery(q)) {
    if (
      text.includes(
        "united states"
      ) ||
      hasToken(text, "usa")
    ) {
      relevance += 0.5;
    }
  }


  // ---------------------------------------------------
  // BASIC RESEARCH
  // ---------------------------------------------------

  if (
    isBasicResearchQuery(q)
  ) {
    if (
      text.includes(
        "basic research"
      ) ||
      text.includes(
        "nghien cuu co ban"
      )
    ) {
      relevance += 0.5;
    }
  }


  // ---------------------------------------------------
  // ACTIVE DEADLINE
  //
  // Very small bonus only.
  // ---------------------------------------------------

  const deadline =
    safeTime(
      fund?.deadline
    );


  if (
    deadline !== null &&
    deadline > Date.now()
  ) {
    relevance += 0.1;
  }


  return relevance;
}


// =====================================================
// SAFE POST-RETRIEVAL FILTER
//
// Do NOT repeat:
// - country filters
// - agency filters
// - year filters
// - deadline filters
//
// fund.search.js owns explicit retrieval constraints.
// =====================================================

function applyPostRetrievalFilters(
  funds
) {
  if (!Array.isArray(funds)) {
    return [];
  }

  return funds.filter(
    fund =>
      hasValue(
        getTitle(fund)
      )
  );
}


// =====================================================
// RANKING
// =====================================================

function rankFunds(
  funds,
  question
) {
  return [...funds]
    .map(
      fund => ({
        ...fund,

        _relevance:
          relevanceScore(
            fund,
            question
          )
      })
    )
    .sort(
      (a, b) => {
        /*
         * 1. Primary search score.
         *
         * fund.search.js already performs semantic +
         * lexical + constraint-aware ranking.
         */
        if (
          b.score !==
          a.score
        ) {
          return (
            b.score -
            a.score
          );
        }


        /*
         * 2. Secondary service relevance.
         */
        if (
          b._relevance !==
          a._relevance
        ) {
          return (
            b._relevance -
            a._relevance
          );
        }


        /*
         * 3. Stable original retrieval order.
         */
        return (
          a._idx -
          b._idx
        );
      }
    );
}


// =====================================================
// REASONING
// =====================================================

function buildReasoning(
  fund,
  question
) {
  const reasons = [];


  const relevance =
    lexicalRelevance(
      fund,
      question
    );


  if (relevance > 0) {
    reasons.push(
      "khớp với chủ đề/yêu cầu tìm kiếm"
    );
  }


  const deadlineInfo =
    getDeadlineInfo(
      fund.deadline
    );


  if (deadlineInfo) {
    reasons.push(
      deadlineInfo
    );
  }


  return reasons.length
    ? `👉 ${reasons.join(", ")}`
    : "";
}


// =====================================================
// RENDER
// =====================================================

function renderFund(
  fund,
  index,
  question
) {
  const lines = [];


  // ---------------------------------------------------
  // TITLE
  // ---------------------------------------------------

  if (fund.title) {
    lines.push(
      `### ${index + 1}. **${fund.title}**`
    );
  }


  // ---------------------------------------------------
  // AGENCY
  // ---------------------------------------------------

  if (fund.agency) {
    lines.push(
      `- 🏢 **Cơ quan tài trợ:** ${fund.agency}`
    );
  }


  if (
    fund.top_level_agency_name &&
    fund.top_level_agency_name !==
      fund.agency
  ) {
    lines.push(
      `- 🏛️ **Cơ quan cấp trên:** ${fund.top_level_agency_name}`
    );
  }


  // ---------------------------------------------------
  // FUNDING
  // ---------------------------------------------------

  const money =
    formatMoney(
      fund.amount,
      fund.amount_num
    );


  if (money) {
    lines.push(
      `- 💵 **Tổng kinh phí:** ${money}`
    );
  }


  const ceiling =
    formatMoney(
      fund.award_ceiling,
      parseAmount(
        fund.award_ceiling
      )
    );


  if (ceiling) {
    lines.push(
      `- 📈 **Mức tài trợ tối đa:** ${ceiling}`
    );
  }


  const floor =
    formatMoney(
      fund.award_floor,
      parseAmount(
        fund.award_floor
      )
    );


  if (floor) {
    lines.push(
      `- 📉 **Mức tài trợ tối thiểu:** ${floor}`
    );
  }


  if (
    hasValue(
      fund.expected_number_of_awards
    )
  ) {
    lines.push(
      `- 🎯 **Số giải dự kiến:** ${fund.expected_number_of_awards}`
    );
  }


  // ---------------------------------------------------
  // DATES
  // ---------------------------------------------------

  if (fund.deadline) {
    lines.push(
      `- 📅 **Hạn nộp:** ${fund.deadline}`
    );
  }


  if (fund.post_date) {
    lines.push(
      `- 🗓️ **Ngày đăng:** ${fund.post_date}`
    );
  }


  // ---------------------------------------------------
  // STATUS / TYPE
  // ---------------------------------------------------

  if (
    fund.opportunity_status
  ) {
    lines.push(
      `- 📌 **Trạng thái:** ${fund.opportunity_status}`
    );
  }


  if (
    fund.funding_instruments
  ) {
    lines.push(
      `- 📑 **Hình thức tài trợ:** ${fund.funding_instruments}`
    );
  }


  // ---------------------------------------------------
  // ELIGIBILITY
  // ---------------------------------------------------

  if (fund.applicant_types) {
    lines.push(
      `- 👥 **Đối tượng:** ${fund.applicant_types}`
    );
  }


  // ---------------------------------------------------
  // OPPORTUNITY NUMBER
  // ---------------------------------------------------

  if (
    fund.opportunity_number
  ) {
    lines.push(
      `- 🆔 **Mã cơ hội:** ${fund.opportunity_number}`
    );
  }


  // ---------------------------------------------------
  // URL
  // ---------------------------------------------------

  if (
    fund.url &&
    /^https?:\/\//i.test(
      fund.url
    )
  ) {
    lines.push(
      `- 🔎 **Liên kết:** ${fund.url}`
    );
  }


  // ---------------------------------------------------
  // REASON
  // ---------------------------------------------------

  const reason =
    buildReasoning(
      fund,
      question
    );


  if (reason) {
    lines.push(
      reason
    );
  }


  return lines.join("\n");
}


// =====================================================
// INTRO
// =====================================================

function buildIntro(question) {
  const q =
    normalizeLower(question);


  if (
    q.includes("nafosted")
  ) {
    return (
      "Các cơ hội tài trợ dưới đây có liên quan đến NAFOSTED theo dữ liệu truy xuất được."
    );
  }


  if (
    isVietnamQuery(q)
  ) {
    return (
      "Các cơ hội tài trợ dưới đây có liên quan đến Việt Nam theo dữ liệu truy xuất được."
    );
  }


  if (
    isUSQuery(q)
  ) {
    return (
      "Các cơ hội tài trợ dưới đây có liên quan đến Hoa Kỳ theo dữ liệu truy xuất được."
    );
  }


  return (
    "Các cơ hội tài trợ liên quan được truy xuất từ dữ liệu hiện có:"
  );
}


// =====================================================
// ANSWER
// =====================================================

function buildAnswer(
  funds,
  question
) {
  if (!funds.length) {
    /*
     * Never claim that such funding does not exist
     * in reality.
     *
     * This statement refers only to current retrieval.
     */
    return (
      "Không tìm thấy cơ hội tài trợ phù hợp trong dữ liệu được truy xuất."
    );
  }


  const lines = [
    buildIntro(question),
    ""
  ];


  funds.forEach(
    (fund, index) => {
      if (index > 0) {
        lines.push("");
      }

      lines.push(
        renderFund(
          fund,
          index,
          question
        )
      );
    }
  );


  return lines
    .filter(
      value =>
        value !== undefined &&
        value !== null
    )
    .join("\n")
    .trim();
}


// =====================================================
// MAIN
// =====================================================

export async function runFundAgent(
  req,
  question,
  model_id,
  topk = MAX_RETURN,
  history = []
) {
  const start =
    Date.now();


  try {
    // =================================================
    // 1. NORMALIZE HISTORY
    //
    // Portal context.history is authoritative.
    //
    // Do not use express-session history.
    // =================================================

    const normalizedHistory =
      normalizeHistory(
        history
      );


    console.log(
      "\n========== FUND AGENT =========="
    );


    console.log(
      "🧠 HISTORY ITEMS:",
      normalizedHistory.length
    );


    console.log(
      "💬 ORIGINAL QUESTION:",
      question
    );


    console.log(
      "🤖 MODEL:",
      model_id ||
      "(none)"
    );


    // =================================================
    // 2. CONTEXTUAL QUERY REWRITE
    //
    // queryRewriter.js is SHARED by:
    //
    // - JOURNAL
    // - CONFERENCE
    // - FUND
    //
    // Only current question + conversation history
    // are passed to it.
    //
    // Example:
    //
    // History:
    //   User: Tìm quỹ tài trợ AI tại Việt Nam
    //
    // Current:
    //   Còn của Mỹ?
    //
    // Standalone:
    //   Tìm quỹ tài trợ AI tại Mỹ
    //
    // standaloneQuestion is used for:
    //
    // - retrieval
    // - retrieval constraints
    // - ranking
    // - deterministic rendering
    // =================================================

    let standaloneQuestion =
      normalizeText(
        question
      );


    try {
      const rewritten =
        await rewriteQuery(
          standaloneQuestion,
          normalizedHistory
        );


      if (
        typeof rewritten ===
          "string" &&
        rewritten.trim()
      ) {
        standaloneQuestion =
          normalizeText(
            rewritten
          );
      }

    } catch (error) {
      /*
       * rewriteQuery() already has its own fallback.
       * This outer guard protects the service as well.
       */
      console.warn(
        "⚠️ FUND QUERY REWRITE FAILED:",
        error?.message ||
        error
      );
    }


    if (!standaloneQuestion) {
      standaloneQuestion =
        normalizeText(
          question
        );
    }


    console.log(
      "🔄 STANDALONE QUESTION:",
      standaloneQuestion
    );


    // =================================================
    // 3. TOP K
    // =================================================

    const requestedTopk =
      Number(topk);


    const finalTopk =
      Math.min(
        Math.max(
          Number.isFinite(
            requestedTopk
          )
            ? Math.floor(
                requestedTopk
              )
            : MAX_RETURN,
          1
        ),
        MAX_RETURN
      );


    console.log(
      "🔢 TOPK:",
      finalTopk
    );


    console.log(
      "================================\n"
    );


    // =================================================
    // 4. RETRIEVAL
    //
    // IMPORTANT:
    //
    // Only standaloneQuestion is used for search.
    // =================================================

    const raw =
      await runFundSearch(
        standaloneQuestion,
        model_id,
        finalTopk
      );


    console.log(
      "📊 FUND SEARCH:",
      Array.isArray(raw)
        ? raw.length
        : 0
    );


    // =================================================
    // 5. NORMALIZE
    // =================================================

    let funds =
      normalizeFunds(
        raw
      );


    // =================================================
    // 6. SAFE POST-RETRIEVAL FILTER
    //
    // Do not repeat:
    //
    // - country constraint
    // - agency constraint
    // - year constraint
    // - deadline constraint
    //
    // fund.search.js owns retrieval constraints.
    // =================================================

    funds =
      applyPostRetrievalFilters(
        funds
      );


    console.log(
      "🧹 AFTER NORMALIZE/FILTER:",
      funds.length
    );


    // =================================================
    // 7. RANKING
    //
    // Search score remains authoritative.
    //
    // Service relevance is only a secondary
    // tie-breaker.
    // =================================================

    funds =
      rankFunds(
        funds,
        standaloneQuestion
      )
        .slice(
          0,
          finalTopk
        );


    console.log(
      "📦 FINAL FUNDS:",
      funds.length
    );


    // =================================================
    // 8. ANSWER
    //
    // Fund remains deterministic at this layer.
    //
    // Because there is currently no final Fund LLM
    // generation in this service, standaloneQuestion
    // is appropriate for deterministic rendering.
    //
    // If buildFundPrompt + callLLM are connected later:
    //
    // - retrieval -> standaloneQuestion
    // - generation -> ORIGINAL question + context/history
    // =================================================

    const answer =
      buildAnswer(
        funds,
        standaloneQuestion
      );


    // =================================================
    // 9. RESPONSE
    //
    // Portal remains authoritative conversation memory.
    //
    // Do NOT addToHistory().
    // =================================================

    return {
      answer,

      funds,

      domain:
        "fund",

      /*
       * Exposed for debugging contextual retrieval.
       *
       * Existing clients may safely ignore it.
       */
      standalone_question:
        standaloneQuestion,

      /*
       * No final LLM is called by this service.
       * Therefore do not fabricate model statistics.
       */
      model: {
        model_id:
          model_id ||
          null,

        model:
          null,

        latency:
          null,

        prompt_tokens:
          null,

        output_tokens:
          null
      },

      responseTimeMs:
        Date.now() -
        start
    };


  } catch (error) {
    console.error(
      "❌ Fund agent error:",
      error
    );


    return {
      answer:
        "Hệ thống đang gặp lỗi, vui lòng thử lại sau.",

      funds:
        [],

      domain:
        "error",

      standalone_question:
        normalizeText(
          question
        ),

      model: {
        model_id:
          model_id ||
          null,

        model:
          null,

        latency:
          null,

        prompt_tokens:
          null,

        output_tokens:
          null
      },

      responseTimeMs:
        Date.now() -
        start
    };
  }
}