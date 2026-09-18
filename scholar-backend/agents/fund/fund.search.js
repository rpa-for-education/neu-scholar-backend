// agents/fund/fund.search.js

import { embed } from "../shared/embedding.js";
import { qdrantClient } from "../../db/qdrant.js";
import { getDb } from "../../db/mongo.js";

import "dotenv/config";


// =====================================================
// CONFIG
// =====================================================

const COLLECTION =
  process.env.QDRANT_COLLECTION_FUND ||
  "fund_vectors";

const CACHE_TTL =
  1000 * 60 * 5;

const EMBED_TTL =
  1000 * 60 * 30;

const TIMEOUT =
  Number(
    process.env.FUND_SEARCH_TIMEOUT_MS
  ) || 1800;

const EMBED_TIMEOUT =
  Number(
    process.env.FUND_EMBED_TIMEOUT_MS
  ) || 1500;

const CACHE_VERSION =
  "v13";

const CACHE =
  new Map();

const EMBED_CACHE =
  new Map();

const MAX_CACHE =
  500;

const MAX_EMBED_CACHE =
  200;

const MAX_VECTOR_LIMIT =
  50;

const MAX_KEYWORD_LIMIT =
  60;


// =====================================================
// BASIC TEXT UTILS
// =====================================================

function normalizeText(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  const text =
    Array.isArray(value)
      ? value.join(" ")
      : String(value);

  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(/đ/g, "d")
    .replace(
      /[^\p{L}\p{N}\s]/gu,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeQuery(query) {
  return normalizeText(
    query
  );
}


function rawText(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (Array.isArray(value)) {
    return value
      .map(rawText)
      .filter(Boolean)
      .join(", ");
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}


function firstValue(...values) {
  for (const value of values) {
    const text =
      rawText(value);

    if (
      text &&
      ![
        "n/a",
        "na",
        "null",
        "undefined"
      ].includes(
        text.toLowerCase()
      )
    ) {
      return text;
    }
  }

  return "";
}


function combineValues(...values) {
  return values
    .map(rawText)
    .filter(Boolean)
    .join(" ");
}


function truncate(
  value,
  maxChars = 3000
) {
  const text =
    rawText(value);

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
// REGEX SAFETY
// =====================================================

function escapeRegex(value) {
  return String(value || "")
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
}


// =====================================================
// FIELD GETTERS
// =====================================================

function getTitle(d) {
  return firstValue(
    d?.opportunity_title,
    d?.title,
    d?.name,
    d?.program_title,
    d?.opportunity_name,
    d?.["OPPORTUNITY TITLE"]
  );
}


function getAgency(d) {
  return firstValue(
    d?.agency_name,
    d?.agency,
    d?.top_level_agency_name,
    d?.funding_agency,
    d?.organization,
    d?.sponsor,
    d?.["AGENCY NAME"]
  );
}


function getAgencyCode(d) {
  return firstValue(
    d?.agency_code,
    d?.agency_id
  );
}


function getTopLevelAgency(d) {
  return firstValue(
    d?.top_level_agency_name,
    d?.parent_agency_name,
    d?.department
  );
}


function getOpportunityId(d) {
  return firstValue(
    d?.opportunity_id,
    d?.opportunity_identifier
  );
}


function getOpportunityNumber(d) {
  return firstValue(
    d?.opportunity_number,
    d?.funding_opportunity_number,
    d?.foa_number,
    d?.notice_number
  );
}


function getStatus(d) {
  return firstValue(
    d?.opportunity_status,
    d?.status
  );
}


function getCategory(d) {
  return firstValue(
    d?.funding_categories,
    d?.funding_category,
    d?.category,
    d?.categories,
    d?.research_area,
    d?.research_areas,
    d?.topics,
    d?.keywords
  );
}


function getCategoryDescription(d) {
  return firstValue(
    d?.funding_category_description,
    d?.category_explanation,
    d?.category_description
  );
}


function getAssistanceListings(d) {
  return firstValue(
    d?.opportunity_assistance_listings,
    d?.assistance_listings,
    d?.assistance_listing,
    d?.cfda_numbers
  );
}


function getFundingInstruments(d) {
  return firstValue(
    d?.funding_instruments,
    d?.funding_instrument,
    d?.instrument_type
  );
}


function getApplicantTypes(d) {
  return firstValue(
    d?.applicant_types,
    d?.applicant_type,
    d?.eligible_applicants,
    d?.eligibility_types
  );
}


function getEligibility(d) {
  return firstValue(
    d?.applicant_eligibility_description,
    d?.applicant_description,
    d?.eligibility_description,
    d?.eligibility
  );
}


function getSummary(d) {
  return firstValue(
    d?.summary_description,
    d?.description,
    d?.text,
    d?.summary,
    d?.["FUNDING DESCRIPTION"],
    d?.additional_info_url_description,
    d?.funding_category_description,
    d?.category_explanation
  );
}


function getDeadline(d) {
  return firstValue(
    d?.close_date,
    d?.deadline,
    d?.application_deadline,
    d?.submission_deadline,
    d?.["ESTIMATED APPLICATION DUE DATE"],
    d?.forecasted_close_date
  );
}


function getPostDate(d) {
  return firstValue(
    d?.post_date,
    d?.posted_date,
    d?.publication_date
  );
}


function getArchiveDate(d) {
  return firstValue(
    d?.archive_date
  );
}


function getFundingAmount(d) {
  return firstValue(
    d?.funding_amount,
    d?.estimated_total_program_funding,
    d?.amount,
    d?.total_funding,
    d?.["ESTIMATED TOTAL FUNDING"]
  );
}


function getAwardCeiling(d) {
  return firstValue(
    d?.award_ceiling,
    d?.maximum_award,
    d?.max_award
  );
}


function getAwardFloor(d) {
  return firstValue(
    d?.award_floor,
    d?.minimum_award,
    d?.min_award
  );
}


function getExpectedAwards(d) {
  return firstValue(
    d?.expected_number_of_awards,
    d?.expected_awards,
    d?.number_of_awards
  );
}


function getUrl(d) {
  return firstValue(
    d?.url,
    d?.link,
    d?.additional_info_url,
    d?.opportunity_url,
    d?.website,
    d?.homepage,
    d?.["OPPORTUNITY URL"],
    d?.["URL"]
  );
}


// =====================================================
// NORMALIZE FUND DOCUMENT
//
// IMPORTANT:
// Keep original payload fields.
// Add normalized aliases instead of replacing the
// original document with only 6 fields.
// =====================================================

function normalizeFundDoc(doc) {
  const d =
    doc || {};

  const title =
    getTitle(d);

  const agency =
    getAgency(d);

  const topLevelAgency =
    getTopLevelAgency(d);

  const agencyCode =
    getAgencyCode(d);

  const category =
    getCategory(d);

  const categoryDescription =
    getCategoryDescription(d);

  const assistanceListings =
    getAssistanceListings(d);

  const fundingInstruments =
    getFundingInstruments(d);

  const applicantTypes =
    getApplicantTypes(d);

  const eligibility =
    getEligibility(d);

  const summary =
    getSummary(d);

  const deadline =
    getDeadline(d);

  const postDate =
    getPostDate(d);

  const archiveDate =
    getArchiveDate(d);

  const amount =
    getFundingAmount(d);

  const awardCeiling =
    getAwardCeiling(d);

  const awardFloor =
    getAwardFloor(d);

  const expectedAwards =
    getExpectedAwards(d);

  const url =
    getUrl(d);

  const opportunityId =
    getOpportunityId(d);

  const opportunityNumber =
    getOpportunityNumber(d);

  const opportunityStatus =
    getStatus(d);


  const searchableText =
    [
      title,
      agency,
      topLevelAgency,
      agencyCode,

      opportunityId,
      opportunityNumber,
      opportunityStatus,

      category,
      categoryDescription,
      assistanceListings,

      fundingInstruments,

      applicantTypes,
      eligibility,

      summary,

      d?.close_date_description,

      d?.agency_contact_description,
      d?.agency_email_address,

      d?.source
    ]
      .map(normalizeText)
      .filter(Boolean)
      .join(" ");


  return {
    // Preserve every field returned from Mongo/Qdrant.
    ...d,

    // Canonical aliases used by search/ranking/prompt.
    title,
    opportunity_title:
      firstValue(
        d?.opportunity_title,
        title
      ),

    agency,
    agency_name:
      firstValue(
        d?.agency_name,
        agency
      ),

    top_level_agency_name:
      firstValue(
        d?.top_level_agency_name,
        topLevelAgency
      ),

    agency_code:
      firstValue(
        d?.agency_code,
        agencyCode
      ),

    opportunity_id:
      firstValue(
        d?.opportunity_id,
        opportunityId
      ),

    opportunity_number:
      firstValue(
        d?.opportunity_number,
        opportunityNumber
      ),

    opportunity_status:
      firstValue(
        d?.opportunity_status,
        opportunityStatus
      ),

    category:
      firstValue(
        d?.category,
        category
      ),

    funding_categories:
      firstValue(
        d?.funding_categories,
        category
      ),

    funding_category_description:
      firstValue(
        d?.funding_category_description,
        categoryDescription
      ),

    opportunity_assistance_listings:
      firstValue(
        d?.opportunity_assistance_listings,
        assistanceListings
      ),

    funding_instruments:
      firstValue(
        d?.funding_instruments,
        fundingInstruments
      ),

    applicant_types:
      firstValue(
        d?.applicant_types,
        applicantTypes
      ),

    applicant_eligibility_description:
      firstValue(
        d?.applicant_eligibility_description,
        eligibility
      ),

    summary_description:
      firstValue(
        d?.summary_description,
        summary
      ),

    deadline,

    close_date:
      firstValue(
        d?.close_date,
        deadline
      ),

    post_date:
      firstValue(
        d?.post_date,
        postDate
      ),

    archive_date:
      firstValue(
        d?.archive_date,
        archiveDate
      ),

    amount,

    funding_amount:
      firstValue(
        d?.funding_amount,
        amount
      ),

    estimated_total_program_funding:
      firstValue(
        d?.estimated_total_program_funding,
        amount
      ),

    award_ceiling:
      firstValue(
        d?.award_ceiling,
        awardCeiling
      ),

    award_floor:
      firstValue(
        d?.award_floor,
        awardFloor
      ),

    expected_number_of_awards:
      firstValue(
        d?.expected_number_of_awards,
        expectedAwards
      ),

    url,

    // Search-only normalized text.
    _searchText:
      searchableText
  };
}


// =====================================================
// CACHE
// =====================================================

function getCache(
  map,
  key,
  ttl
) {
  const item =
    map.get(key);

  if (!item) {
    return null;
  }

  if (
    Date.now() -
      item.time >
    ttl
  ) {
    map.delete(key);

    return null;
  }

  return item.value;
}


function setCache(
  map,
  key,
  value,
  maxSize = MAX_CACHE
) {
  if (
    map.size >= maxSize
  ) {
    const firstKey =
      map
        .keys()
        .next()
        .value;

    if (firstKey) {
      map.delete(
        firstKey
      );
    }
  }

  map.set(
    key,
    {
      time:
        Date.now(),

      value
    }
  );
}


// =====================================================
// QUERY EXPANSION
// =====================================================

function expandQuery(query) {
  const q =
    normalizeQuery(
      query
    );

  const additions = [];


  if (
    q.includes("quy") ||
    q.includes("tai tro")
  ) {
    additions.push(
      "fund grant funding research funding"
    );
  }


  if (
    q.includes("nghien cuu")
  ) {
    additions.push(
      "research science scientific"
    );
  }


  if (
    q.includes("nafosted")
  ) {
    additions.push(
      "nafosted vietnam national foundation for science and technology development"
    );
  }


  if (
    q.includes("viet nam") ||
    q.includes("vietnam")
  ) {
    additions.push(
      "vietnam vietnamese"
    );
  }


  if (
    q.includes("my") ||
    q.includes("hoa ky") ||
    q.includes("united states") ||
    q.includes("usa")
  ) {
    additions.push(
      "united states usa federal"
    );
  }


  if (
    q.includes("nsf")
  ) {
    additions.push(
      "national science foundation nsf"
    );
  }


  if (
    q.includes("nasa")
  ) {
    additions.push(
      "national aeronautics and space administration nasa"
    );
  }


  if (
    q.includes("nih")
  ) {
    additions.push(
      "national institutes of health nih"
    );
  }


  return [
    q,
    ...additions
  ]
    .filter(Boolean)
    .join(" ");
}


// =====================================================
// EMBEDDING QUERY
// =====================================================

function cleanQueryForEmbed(query) {
  return normalizeQuery(
    query
  )
    .replace(
      /\b20\d{2}\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}


// =====================================================
// TOP K
// =====================================================

function safeTopk(topk) {
  return Math.max(
    1,
    Math.min(
      Number(topk) || 5,
      20
    )
  );
}


// =====================================================
// YEAR
// =====================================================

function extractYear(query) {
  const match =
    String(query || "")
      .match(
        /\b(20\d{2})\b/
      );

  return match
    ? Number(match[1])
    : null;
}


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


function getYearsFromFund(fund) {
  const years =
    new Set();


  const explicitFiscalYear =
    Number(
      firstValue(
        fund?.fiscal_year,
        fund?.fy
      )
    );


  if (
    Number.isInteger(
      explicitFiscalYear
    ) &&
    explicitFiscalYear >= 2000 &&
    explicitFiscalYear <= 2100
  ) {
    years.add(
      explicitFiscalYear
    );
  }


  const dates = [
    fund?.close_date,
    fund?.deadline,
    fund?.post_date,
    fund?.archive_date,

    fund?.forecasted_post_date,
    fund?.forecasted_close_date,

    fund?.forecasted_award_date,
    fund?.forecasted_project_start_date
  ];


  for (const value of dates) {
    const time =
      safeTime(value);

    if (time === null) {
      continue;
    }

    years.add(
      new Date(time)
        .getUTCFullYear()
    );
  }


  return [
    ...years
  ];
}


// =====================================================
// QUERY TOKENIZATION
// =====================================================

const STOP_WORDS =
  new Set([
    // Vietnamese generic words
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
    "tai",
    "thuoc",
    "lien",
    "quan",
    "nghien",
    "cuu",
    "con",
    "thi",
    "sao",
    "nao",

    // English generic words
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
    "on",

    // Years are handled separately.
    "2024",
    "2025",
    "2026",
    "2027",
    "2028",
    "2029",
    "2030"
  ]);


function tokenize(value) {
  return normalizeText(
    value
  )
    .split(/\s+/)
    .filter(
      token =>
        token.length >= 2 &&
        !STOP_WORDS.has(token) &&
        !/^20\d{2}$/.test(token)
    );
}


function uniqueTokens(tokens) {
  return [
    ...new Set(tokens)
  ];
}


// =====================================================
// QUERY INTENT HELPERS
// =====================================================

function detectAgencyHint(query) {
  const q =
    normalizeQuery(
      query
    );


  const agencies = [
    {
      match: [
        "nafosted"
      ],
      values: [
        "nafosted",
        "national foundation for science and technology development"
      ]
    },

    {
      match: [
        "nsf",
        "national science foundation"
      ],
      values: [
        "nsf",
        "national science foundation"
      ]
    },

    {
      match: [
        "nasa"
      ],
      values: [
        "nasa",
        "national aeronautics and space administration"
      ]
    },

    {
      match: [
        "nih",
        "national institutes of health"
      ],
      values: [
        "nih",
        "national institutes of health"
      ]
    }
  ];


  for (const agency of agencies) {
    if (
      agency.match.some(
        value =>
          q.includes(
            normalizeText(value)
          )
      )
    ) {
      return agency.values;
    }
  }


  return [];
}


function detectCountryHint(query) {
  const q =
    normalizeQuery(
      query
    );


  const countries = [
    {
      match: [
        "viet nam",
        "vietnam"
      ],

      terms: [
        "vietnam",
        "viet nam",
        "nafosted"
      ]
    },

    {
      match: [
        "hoa ky",
        "united states",
        "usa"
      ],

      terms: [
        "united states",
        "usa",
        "u s",
        "federal"
      ]
    }
  ];


  for (const country of countries) {
    if (
      country.match.some(
        value =>
          q.includes(
            normalizeText(value)
          )
      )
    ) {
      return country.terms;
    }
  }


  return [];
}


// =====================================================
// SEARCHABLE TEXT
// =====================================================

function buildSearchableText(fund) {
  const d =
    normalizeFundDoc(
      fund
    );


  return [
    // Highest-value fields
    d?.opportunity_title,
    d?.title,

    d?.agency_name,
    d?.agency,
    d?.top_level_agency_name,
    d?.agency_code,

    // Identifiers
    d?.opportunity_number,
    d?.opportunity_id,

    // Research/category information
    d?.category,
    d?.funding_categories,
    d?.funding_category_description,

    d?.opportunity_assistance_listings,

    // Funding type
    d?.funding_instruments,

    // Applicant / eligibility
    d?.applicant_types,
    d?.applicant_eligibility_description,

    // Description
    d?.summary_description,
    d?.description,
    d?.text,

    // Status/source
    d?.opportunity_status,
    d?.source
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");
}


// =====================================================
// LEXICAL SCORE
// =====================================================

function lexicalScore(
  fund,
  query
) {
  const normalized =
    normalizeFundDoc(
      fund
    );


  const queryTokens =
    uniqueTokens(
      tokenize(
        query
      )
    );


  if (!queryTokens.length) {
    return 0;
  }


  const title =
    normalizeText(
      normalized.title
    );

  const agency =
    normalizeText(
      combineValues(
        normalized.agency,
        normalized.top_level_agency_name,
        normalized.agency_code
      )
    );

  const category =
    normalizeText(
      combineValues(
        normalized.category,
        normalized.funding_categories,
        normalized.funding_category_description,
        normalized.opportunity_assistance_listings
      )
    );

  const summary =
    normalizeText(
      combineValues(
        normalized.summary_description,
        normalized.description,
        normalized.text
      )
    );

  const eligibility =
    normalizeText(
      combineValues(
        normalized.applicant_types,
        normalized.applicant_eligibility_description
      )
    );


  let titleHits = 0;
  let agencyHits = 0;
  let categoryHits = 0;
  let summaryHits = 0;
  let eligibilityHits = 0;


  for (const token of queryTokens) {
    if (
      title.includes(token)
    ) {
      titleHits += 1;
    }

    if (
      agency.includes(token)
    ) {
      agencyHits += 1;
    }

    if (
      category.includes(token)
    ) {
      categoryHits += 1;
    }

    if (
      summary.includes(token)
    ) {
      summaryHits += 1;
    }

    if (
      eligibility.includes(token)
    ) {
      eligibilityHits += 1;
    }
  }


  const count =
    queryTokens.length;


  return (
    (titleHits / count) *
      0.55 +

    (agencyHits / count) *
      0.45 +

    (categoryHits / count) *
      0.45 +

    (summaryHits / count) *
      0.25 +

    (eligibilityHits / count) *
      0.15
  );
}


// =====================================================
// AGENCY SCORE
// =====================================================

function agencyScore(
  fund,
  agencyHints
) {
  if (
    !agencyHints.length
  ) {
    return 0;
  }


  const agencyText =
    normalizeText(
      combineValues(
        getAgency(fund),
        getTopLevelAgency(fund),
        getAgencyCode(fund)
      )
    );


  if (!agencyText) {
    return 0;
  }


  const matched =
    agencyHints.some(
      hint =>
        agencyText.includes(
          normalizeText(hint)
        )
    );


  return matched
    ? 1.0
    : -0.45;
}


// =====================================================
// COUNTRY SCORE
// =====================================================

function countryScore(
  fund,
  countryHints
) {
  if (
    !countryHints.length
  ) {
    return 0;
  }


  /*
   * Grants.gov records often do not have a dedicated
   * country field.
   *
   * Therefore country evidence can occur in:
   * agency, title, category, summary or eligibility.
   */
  const text =
    buildSearchableText(
      fund
    );


  const matched =
    countryHints.some(
      hint =>
        text.includes(
          normalizeText(hint)
        )
    );


  return matched
    ? 0.6
    : 0;
}


// =====================================================
// YEAR SCORE
// =====================================================

function yearScore(
  fund,
  year
) {
  if (!year) {
    return 0;
  }


  const years =
    getYearsFromFund(
      fund
    );


  if (!years.length) {
    return 0;
  }


  return years.includes(year)
    ? 0.45
    : -0.25;
}


// =====================================================
// DEADLINE / ACTIVE INTENT
// =====================================================

function wantsActiveFunding(
  query
) {
  const q =
    normalizeQuery(
      query
    );


  const phrases = [
    "con han",
    "con mo",
    "dang mo",
    "dang nhan",
    "sap het han",
    "deadline",
    "open",
    "currently open",
    "active"
  ];


  return phrases.some(
    phrase =>
      q.includes(
        normalizeText(phrase)
      )
  );
}


function deadlineScore(
  fund,
  query
) {
  if (
    !wantsActiveFunding(query)
  ) {
    return 0;
  }


  const deadline =
    safeTime(
      getDeadline(fund)
    );


  if (
    deadline === null
  ) {
    return 0;
  }


  const now =
    Date.now();


  const diffDays =
    (deadline - now) /
    86_400_000;


  if (diffDays < 0) {
    return -0.8;
  }


  let score =
    0.5;


  if (
    diffDays <= 90
  ) {
    score +=
      Math.max(
        0,
        0.15 -
          diffDays / 600
      );
  }


  return score;
}


// =====================================================
// FINAL SCORE
// =====================================================

function computeFinalScore(
  result,
  {
    query,
    year,
    agencyHints,
    countryHints
  }
) {
  const payload =
    normalizeFundDoc(
      result?.payload ||
      result
    );


  const vectorScore =
    Number(
      result?.score ??
      result?.baseScore ??
      0
    );


  let score =
    vectorScore;


  score +=
    lexicalScore(
      payload,
      query
    );


  score +=
    agencyScore(
      payload,
      agencyHints
    );


  score +=
    countryScore(
      payload,
      countryHints
    );


  score +=
    yearScore(
      payload,
      year
    );


  score +=
    deadlineScore(
      payload,
      query
    );


  return score;
}


// =====================================================
// TIMEOUT
// =====================================================

function withTimeout(
  promise,
  ms = TIMEOUT
) {
  let timer;


  const timeout =
    new Promise(
      (
        _,
        reject
      ) => {
        timer =
          setTimeout(
            () =>
              reject(
                new Error(
                  "timeout"
                )
              ),
            ms
          );
      }
    );


  return Promise
    .race([
      promise,
      timeout
    ])
    .finally(
      () => {
        if (timer) {
          clearTimeout(
            timer
          );
        }
      }
    );
}


// =====================================================
// KEYWORD SEARCH
// =====================================================

async function keywordSearch(
  query,
  limit
) {
  try {
    const db =
      await getDb();


    const tokens =
      uniqueTokens(
        tokenize(
          query
        )
      )
        .slice(
          0,
          12
        );


    if (!tokens.length) {
      return [];
    }


    /*
     * Search across the real Fund schema.
     *
     * Important:
     * Mongo regex is escaped to prevent regex syntax
     * from user input changing the query.
     */
    const searchableFields = [
      "opportunity_title",
      "title",

      "agency",
      "agency_name",
      "agency_code",
      "top_level_agency_name",

      "opportunity_number",
      "opportunity_id",

      "category",
      "funding_categories",
      "funding_category_description",

      "opportunity_assistance_listings",

      "funding_instruments",

      "applicant_types",
      "applicant_eligibility_description",

      "summary_description",
      "description",
      "text",

      "opportunity_status",
      "source"
    ];


    const orConditions = [];


    for (const token of tokens) {
      const regex =
        escapeRegex(
          token
        );


      for (
        const field of
        searchableFields
      ) {
        orConditions.push({
          [field]: {
            $regex:
              regex,

            $options:
              "i"
          }
        });
      }
    }


    if (
      !orConditions.length
    ) {
      return [];
    }


    const docs =
      await db
        .collection("fund")
        .find({
          $or:
            orConditions
        })
        .limit(
          Math.min(
            Math.max(
              limit * 3,
              20
            ),
            MAX_KEYWORD_LIMIT
          )
        )
        .toArray();


    return docs
      .map(
        doc => {
          const payload =
            normalizeFundDoc(
              doc
            );


          const lexical =
            lexicalScore(
              payload,
              query
            );


          return {
            id:
              String(
                doc?._id ||
                doc?.u_key ||
                doc?.opportunity_id ||
                ""
              ),

            payload,

            /*
             * Keyword candidates receive a modest
             * base score. Detailed ranking happens
             * later using the same scoring engine.
             */
            score:
              0.15 +
              lexical
          };
        }
      )
      .sort(
        (a, b) =>
          Number(
            b.score || 0
          ) -
          Number(
            a.score || 0
          )
      )
      .slice(
        0,
        limit
      );

  } catch (error) {
    console.error(
      "⚠️ fund keyword search:",
      error?.message ||
      error
    );

    return [];
  }
}


// =====================================================
// RESULT IDENTITY
// =====================================================

function getResultKey(result) {
  const payload =
    normalizeFundDoc(
      result?.payload ||
      result
    );


  const stable =
    firstValue(
      payload?.u_key,
      payload?.opportunity_id,
      payload?.opportunity_number
    );


  if (stable) {
    return normalizeText(
      stable
    );
  }


  const title =
    normalizeText(
      getTitle(
        payload
      )
    );


  const agency =
    normalizeText(
      getAgency(
        payload
      )
    );


  if (
    title ||
    agency
  ) {
    return [
      title,
      agency
    ]
      .filter(Boolean)
      .join("|");
  }


  if (result?.id) {
    return String(
      result.id
    );
  }


  return "";
}


// =====================================================
// MERGE VECTOR + KEYWORD
// =====================================================

function mergeResults(
  vectorResults,
  keywordResults
) {
  const map =
    new Map();


  for (
    const result of
    vectorResults
  ) {
    const payload =
      normalizeFundDoc(
        result?.payload ||
        result
      );


    const normalized = {
      ...result,
      payload,
      score:
        Number(
          result?.score || 0
        )
    };


    const key =
      getResultKey(
        normalized
      );


    if (!key) {
      continue;
    }


    const existing =
      map.get(key);


    if (
      !existing ||
      normalized.score >
        existing.score
    ) {
      map.set(
        key,
        normalized
      );
    }
  }


  for (
    const result of
    keywordResults
  ) {
    const payload =
      normalizeFundDoc(
        result?.payload ||
        result
      );


    const normalized = {
      ...result,
      payload,
      score:
        Number(
          result?.score || 0
        )
    };


    const key =
      getResultKey(
        normalized
      );


    if (!key) {
      continue;
    }


    const existing =
      map.get(key);


    if (existing) {
      /*
       * Candidate found by BOTH semantic vector search
       * and Mongo keyword search receives a bonus.
       */
      const bestScore =
        Math.max(
          Number(
            existing.score || 0
          ),
          Number(
            normalized.score || 0
          )
        );


      map.set(
        key,
        {
          ...existing,

          payload: {
            ...normalized.payload,
            ...existing.payload
          },

          score:
            bestScore +
            0.25,

          _hybridMatch:
            true
        }
      );

    } else {
      map.set(
        key,
        normalized
      );
    }
  }


  return [
    ...map.values()
  ];
}


// =====================================================
// SAFE YEAR FILTER
// =====================================================

function applyYearConstraint(
  results,
  year,
  limit
) {
  if (!year) {
    return results;
  }


  const exact =
    results.filter(
      result =>
        getYearsFromFund(
          result?.payload ||
          result
        ).includes(year)
    );


  /*
   * Preserve the good behavior of the previous version:
   *
   * Apply a hard year constraint only when enough
   * matching candidates exist.
   *
   * Otherwise year remains a ranking signal rather
   * than destroying semantically useful results.
   */
  if (
    exact.length >=
    Math.min(
      2,
      limit
    )
  ) {
    return exact;
  }


  return results;
}


// =====================================================
// SAFE AGENCY FILTER
// =====================================================

function applyAgencyConstraint(
  results,
  agencyHints
) {
  if (
    !agencyHints.length
  ) {
    return results;
  }


  const exact =
    results.filter(
      result => {
        const payload =
          result?.payload ||
          result;


        const agencyText =
          normalizeText(
            combineValues(
              getAgency(payload),
              getTopLevelAgency(payload),
              getAgencyCode(payload)
            )
          );


        return agencyHints.some(
          hint =>
            agencyText.includes(
              normalizeText(hint)
            )
        );
      }
    );


  /*
   * Agency is normally an explicit and strong
   * user constraint.
   *
   * If at least one exact candidate exists,
   * use exact agency matches only.
   *
   * If none exist, preserve the pool instead of
   * falsely concluding that no result exists.
   */
  return exact.length
    ? exact
    : results;
}


// =====================================================
// VECTOR SEARCH
// =====================================================

async function vectorSearch(
  vector,
  limit
) {
  if (!vector) {
    return [];
  }


  try {
    const results =
      await withTimeout(
        qdrantClient.search(
          COLLECTION,
          {
            vector,

            limit:
              Math.min(
                Math.max(
                  limit * 5,
                  20
                ),
                MAX_VECTOR_LIMIT
              ),

            with_payload:
              true,

            score_threshold:
              0.05
          }
        ),
        TIMEOUT
      );


    return results.map(
      result => ({
        ...result,

        payload:
          normalizeFundDoc(
            result?.payload ||
            {}
          ),

        score:
          Number(
            result?.score || 0
          )
      })
    );

  } catch (error) {
    console.error(
      "⚠️ fund vector search:",
      error?.message ||
      error
    );

    return [];
  }
}


// =====================================================
// MAIN
// =====================================================

export async function searchFund(
  query,
  topk = 5
) {
  try {
    // =================================================
    // INPUT
    // =================================================

    const rawQuery =
      String(
        query || ""
      ).trim();


    if (!rawQuery) {
      return [];
    }


    const normalized =
      normalizeQuery(
        rawQuery
      );


    const expandedQuery =
      expandQuery(
        normalized
      );


    const limit =
      safeTopk(
        topk
      );


    const year =
      extractYear(
        rawQuery
      );


    const agencyHints =
      detectAgencyHint(
        rawQuery
      );


    const countryHints =
      detectCountryHint(
        rawQuery
      );


    // =================================================
    // CACHE
    // =================================================

    const cacheKey = [
      CACHE_VERSION,
      normalized,
      expandedQuery,
      limit,
      year || "all",
      agencyHints.join(",") ||
        "all-agencies",
      countryHints.join(",") ||
        "all-countries"
    ].join(":");


    const cached =
      getCache(
        CACHE,
        cacheKey,
        CACHE_TTL
      );


    if (cached) {
      return cached;
    }


    console.log(
      "🔎 FUND SEARCH:",
      {
        query:
          rawQuery,

        year:
          year || null,

        agency:
          agencyHints.length
            ? agencyHints
            : null,

        country:
          countryHints.length
            ? countryHints
            : null,

        topk:
          limit
      }
    );


    // =================================================
    // EMBEDDING
    // =================================================

    const embedQuery =
      cleanQueryForEmbed(
        expandedQuery
      );


    let vector =
      getCache(
        EMBED_CACHE,
        embedQuery,
        EMBED_TTL
      );


    if (!vector) {
      vector =
        await withTimeout(
          embed(
            embedQuery
          ),
          EMBED_TIMEOUT
        ).catch(
          error => {
            console.error(
              "⚠️ fund embed:",
              error?.message ||
              error
            );

            return null;
          }
        );


      if (vector) {
        setCache(
          EMBED_CACHE,
          embedQuery,
          vector,
          MAX_EMBED_CACHE
        );
      }
    }


    // =================================================
    // HYBRID SEARCH
    //
    // Run vector + Mongo keyword search in parallel.
    // =================================================

    const [
      vectorResults,
      keywordResults
    ] =
      await Promise.all([
        vectorSearch(
          vector,
          limit
        ),

        keywordSearch(
          normalized,
          Math.min(
            limit * 4,
            MAX_KEYWORD_LIMIT
          )
        )
      ]);


    // =================================================
    // MERGE
    // =================================================

    let merged =
      mergeResults(
        vectorResults,
        keywordResults
      );


    if (!merged.length) {
      setCache(
        CACHE,
        cacheKey,
        []
      );

      return [];
    }


    // =================================================
    // FINAL RANKING
    // =================================================

    merged =
      merged.map(
        result => ({
          ...result,

          score:
            computeFinalScore(
              result,
              {
                query:
                  normalized,

                year,

                agencyHints,

                countryHints
              }
            )
        })
      );


    // =================================================
    // EXPLICIT AGENCY CONSTRAINT
    // =================================================

    merged =
      applyAgencyConstraint(
        merged,
        agencyHints
      );


    // =================================================
    // SAFE YEAR CONSTRAINT
    // =================================================

    merged =
      applyYearConstraint(
        merged,
        year,
        limit
      );


    // =================================================
    // SORT
    // =================================================

    merged.sort(
      (a, b) =>
        Number(
          b.score || 0
        ) -
        Number(
          a.score || 0
        )
    );


    // =================================================
    // CLEAN FINAL RESULT
    //
    // Keep full normalized payload so fund.prompt.js
    // can use all available fields.
    // =================================================

    const finalResult =
      merged
        .slice(
          0,
          limit
        )
        .map(
          result => ({
            ...result,

            payload: {
              ...result.payload
            }
          })
        );


    console.log(
      "📊 FUND SEARCH RESULT:",
      {
        vector:
          vectorResults.length,

        keyword:
          keywordResults.length,

        merged:
          merged.length,

        returned:
          finalResult.length,

        year:
          year || null,

        agency:
          agencyHints.length
            ? agencyHints[0]
            : null
      }
    );


    // =================================================
    // CACHE
    // =================================================

    setCache(
      CACHE,
      cacheKey,
      finalResult
    );


    return finalResult;

  } catch (error) {
    console.error(
      "❌ searchFund error:",
      error?.message ||
      error
    );

    return [];
  }
}