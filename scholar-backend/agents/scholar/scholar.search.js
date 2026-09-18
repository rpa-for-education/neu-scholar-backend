// agents/scholar/scholar.search.js

import { qdrantClient as qdrant } from "../../db/qdrant.js";

import {
  detectDomain,
  analyzeQuestion
} from "./agentReasoning.js";

import {
  embedBatch
} from "../shared/embedding.js";

import "dotenv/config";


// =====================================================
// CONFIG
// =====================================================

const MAX_LIMIT = 40;

const QUERY_CACHE = new Map();
const QUERY_TTL = 1000 * 60 * 5;


// =====================================================
// TEXT UTILS
// =====================================================

function cleanQuery(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}


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
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function toText(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (Array.isArray(value)) {
    return value
      .map(toText)
      .filter(Boolean)
      .join(" ");
  }

  if (
    typeof value === "object"
  ) {
    return Object.values(value)
      .map(toText)
      .filter(Boolean)
      .join(" ");
  }

  return normalizeText(value);
}


function firstValue(...values) {
  for (const value of values) {
    if (
      value === null ||
      value === undefined
    ) {
      continue;
    }

    const text =
      Array.isArray(value)
        ? value
            .map(v => String(v || "").trim())
            .filter(Boolean)
            .join(", ")
        : String(value).trim();

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


// =====================================================
// COUNTRY
// =====================================================

const COUNTRY_ALIASES = {
  vn: "vietnam",
  vietnam: "vietnam",
  "viet nam": "vietnam",

  us: "united states",
  usa: "united states",
  "u s": "united states",
  "u s a": "united states",
  america: "united states",
  "united states": "united states",
  "united states of america": "united states",

  uk: "united kingdom",
  "u k": "united kingdom",
  britain: "united kingdom",
  england: "united kingdom",
  "great britain": "united kingdom",
  "united kingdom": "united kingdom",

  japan: "japan",
  singapore: "singapore",
  australia: "australia",
  canada: "canada",
  china: "china",
  france: "france",
  germany: "germany",
  italy: "italy",
  spain: "spain",
  portugal: "portugal",
  korea: "south korea",
  "south korea": "south korea",
  "republic of korea": "south korea"
};


function normalizeCountry(value) {
  const text =
    normalizeText(value);

  return (
    COUNTRY_ALIASES[text] ||
    text
  );
}


function getCountry(item) {
  return firstValue(
    item?.country,
    item?.country_name,
    item?.location_country,
    item?.nation
  );
}


function countryMatches(
  item,
  targetCountry
) {
  const target =
    normalizeCountry(
      targetCountry
    );

  if (!target) {
    return true;
  }

  const values = [
    item?.country,
    item?.country_name,
    item?.location_country,
    item?.nation,
    item?.location
  ]
    .map(normalizeCountry)
    .filter(Boolean);

  return values.some(
    value =>
      value === target ||
      value.includes(target) ||
      target.includes(value)
  );
}


// =====================================================
// QUARTILE
// =====================================================

function normalizeQuartile(value) {
  const text =
    String(value || "")
      .toUpperCase()
      .trim();

  const match =
    text.match(
      /\bQ\s*([1-4])\b/i
    );

  return match
    ? `Q${match[1]}`
    : "";
}


function getQuartiles(item) {
  const values = [
    item?.quartile,
    item?.sjr_best_quartile,
    item?.best_quartile,
    item?.sjr_quartile,
    item?.q,
    item?.categories,
    item?.category,
    item?.areas,
    item?.area
  ];

  const quartiles =
    new Set();


  for (const value of values) {
    const text =
      Array.isArray(value)
        ? value.join(" ")
        : String(value || "");

    const matches =
      text
        .toUpperCase()
        .match(
          /\bQ\s*[1-4]\b/g
        );

    if (!matches) {
      continue;
    }

    for (const match of matches) {
      const q =
        normalizeQuartile(
          match
        );

      if (q) {
        quartiles.add(q);
      }
    }
  }


  return [
    ...quartiles
  ];
}


function quartileMatches(
  item,
  targetQuartile
) {
  const target =
    normalizeQuartile(
      targetQuartile
    );

  if (!target) {
    return true;
  }

  return getQuartiles(item)
    .includes(target);
}


// =====================================================
// EXTRACT QUERY CONSTRAINTS
// =====================================================

function extractQuartile(
  question,
  analysis = {}
) {
  const candidates = [
    analysis?.quartile,
    analysis?.wantsQuartile,
    analysis?.quartileHint,
    analysis?.targetQuartile
  ];


  for (const candidate of candidates) {
    const quartile =
      normalizeQuartile(
        candidate
      );

    if (quartile) {
      return quartile;
    }
  }


  return normalizeQuartile(
    question
  );
}


function extractCountry(
  analysis = {}
) {
  return firstValue(
    analysis?.wantsCountryCode,
    analysis?.countryCode,
    analysis?.country,
    analysis?.countryHint,
    analysis?.targetCountry
  );
}


// =====================================================
// RESOURCE TYPE
// =====================================================

function getExplicitType(item) {
  return normalizeText(
    item?.type ||
    item?.resource_type ||
    item?.resourceType ||
    item?.kind
  );
}


function isConference(item) {
  const explicit =
    getExplicitType(item);

  if (
    explicit === "conference"
  ) {
    return true;
  }

  if (
    explicit === "journal"
  ) {
    return false;
  }

  const conferenceSignals = [
    item?.deadline,
    item?.submission_deadline,
    item?.start_date,
    item?.end_date,
    item?.acronym,
    item?.topics,
    item?.cfp_text,
    item?.crawl_source
  ].filter(
    value =>
      value !== null &&
      value !== undefined &&
      value !== ""
  ).length;


  const journalSignals = [
    item?.quartile,
    item?.sjr_best_quartile,
    item?.sjr,
    item?.h_index,
    item?.issn,
    item?.publisher,
    item?.categories,
    item?.areas
  ].filter(
    value =>
      value !== null &&
      value !== undefined &&
      value !== ""
  ).length;


  return (
    conferenceSignals >
    journalSignals
  );
}


function isJournal(item) {
  const explicit =
    getExplicitType(item);

  if (
    explicit === "journal"
  ) {
    return true;
  }

  if (
    explicit === "conference"
  ) {
    return false;
  }

  const journalSignals = [
    item?.quartile,
    item?.sjr_best_quartile,
    item?.sjr,
    item?.h_index,
    item?.issn,
    item?.publisher,
    item?.categories,
    item?.areas
  ].filter(
    value =>
      value !== null &&
      value !== undefined &&
      value !== ""
  ).length;


  const conferenceSignals = [
    item?.deadline,
    item?.submission_deadline,
    item?.start_date,
    item?.end_date,
    item?.acronym,
    item?.topics,
    item?.cfp_text,
    item?.crawl_source
  ].filter(
    value =>
      value !== null &&
      value !== undefined &&
      value !== ""
  ).length;


  return (
    journalSignals >=
    conferenceSignals
  );
}


// =====================================================
// SEARCHABLE TEXT
// =====================================================

function buildJournalSearchText(
  item
) {
  return [
    item?.title,
    item?.name,
    item?.journal_title,
    item?.source_title,

    item?.publisher,
    item?.publisher_name,
    item?.publisher_alt,

    item?.categories,
    item?.category,

    item?.areas,
    item?.area,

    item?.fields,
    item?.field,

    item?.subjects,
    item?.subject,

    item?.topics,
    item?.topic,

    item?.text,
    item?.description,

    item?.country,
    item?.country_name,
    item?.region,

    item?.issn,
    item?.primary_issn
  ]
    .map(toText)
    .filter(Boolean)
    .join(" ");
}


function buildConferenceSearchText(
  item
) {
  return [
    item?.name,
    item?.title,
    item?.conference_name,
    item?.event_name,

    item?.acronym,

    item?.topics,
    item?.topic,

    item?.fields,
    item?.field,

    item?.categories,
    item?.category,

    item?.areas,
    item?.area,

    item?.subjects,
    item?.subject,

    item?.keywords,
    item?.keyword,

    item?.cfp_text,
    item?.cfp,
    item?.description,
    item?.text,

    item?.location,
    item?.city,
    item?.country,
    item?.country_name
  ]
    .map(toText)
    .filter(Boolean)
    .join(" ");
}


function buildSearchableText(
  item
) {
  if (isConference(item)) {
    return buildConferenceSearchText(
      item
    );
  }

  return buildJournalSearchText(
    item
  );
}


// =====================================================
// TOKEN UTILS
// =====================================================

const STOP_WORDS =
  new Set([
    // Vietnamese
    "cho",
    "toi",
    "tim",
    "kiem",
    "ve",
    "thuoc",
    "trong",
    "linh",
    "vuc",
    "cac",
    "nhung",
    "mot",
    "so",
    "va",
    "hoac",
    "tai",
    "o",
    "cua",
    "con",
    "thi",
    "sao",
    "nao",
    "giup",

    // Resource words
    "tap",
    "chi",
    "journal",
    "journals",
    "hoi",
    "thao",
    "conference",
    "conferences",

    // English
    "find",
    "show",
    "give",
    "me",
    "about",
    "for",
    "in",
    "on",
    "the",
    "a",
    "an",
    "of",
    "and",
    "or",

    // Quartile tokens are handled separately
    "q1",
    "q2",
    "q3",
    "q4"
  ]);


function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(
      token =>
        token.length >= 2 &&
        !STOP_WORDS.has(token)
    );
}


function uniqueTokens(tokens) {
  return [
    ...new Set(tokens)
  ];
}


// =====================================================
// FIELD HINT
// =====================================================

function getFieldHint(
  analysis = {}
) {
  return firstValue(
    analysis?.fieldHint,
    analysis?.field,
    analysis?.topic,
    analysis?.topicHint,
    analysis?.keywords
  );
}


// =====================================================
// LEXICAL MATCH
// =====================================================

function lexicalScore(
  item,
  queryText
) {
  const searchable =
    buildSearchableText(
      item
    );

  if (
    !searchable ||
    !queryText
  ) {
    return 0;
  }


  const queryTokens =
    uniqueTokens(
      tokenize(
        queryText
      )
    );


  if (!queryTokens.length) {
    return 0;
  }


  let matched = 0;

  for (const token of queryTokens) {
    if (
      searchable.includes(token)
    ) {
      matched += 1;
    }
  }


  const ratio =
    matched /
    queryTokens.length;


  let score =
    ratio * 0.45;


  const normalizedQuery =
    normalizeText(
      queryText
    );


  if (
    normalizedQuery.length >= 4 &&
    searchable.includes(
      normalizedQuery
    )
  ) {
    score += 0.25;
  }


  return Math.min(
    score,
    0.7
  );
}


// =====================================================
// FIELD / TOPIC MATCH
// =====================================================

function fieldMatchScore(
  item,
  fieldHint
) {
  const field =
    normalizeText(
      fieldHint
    );

  if (!field) {
    return 0;
  }


  const fieldTokens =
    uniqueTokens(
      tokenize(field)
    );


  if (!fieldTokens.length) {
    return 0;
  }


  const searchable =
    buildSearchableText(
      item
    );


  if (!searchable) {
    return 0;
  }


  let score = 0;


  // Exact normalized phrase
  if (
    searchable.includes(field)
  ) {
    score += 0.35;
  }


  // Token overlap
  let matched = 0;

  for (const token of fieldTokens) {
    if (
      searchable.includes(token)
    ) {
      matched += 1;
    }
  }


  const ratio =
    matched /
    fieldTokens.length;


  score +=
    ratio * 0.35;


  return Math.min(
    score,
    0.7
  );
}


// =====================================================
// DATE UTILS
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


function getDeadline(item) {
  return firstValue(
    item?.deadline,
    item?.submission_deadline,
    item?.paper_deadline,
    item?.cfp_deadline,
    item?.close_date
  );
}


function getStartDate(item) {
  return firstValue(
    item?.start_date,
    item?.event_date,
    item?.conference_date,
    item?.date
  );
}


// =====================================================
// DEADLINE INTENT
// =====================================================

function wantsActiveConference(
  question,
  analysis = {}
) {
  if (
    analysis?.wantsOpen === true ||
    analysis?.wantsUpcoming === true ||
    analysis?.futureOnly === true ||
    analysis?.activeOnly === true
  ) {
    return true;
  }


  const q =
    normalizeText(
      question
    );


  const phrases = [
    "con han",
    "con deadline",
    "con mo",
    "dang mo",
    "sap toi",
    "sắp tới",
    "upcoming",
    "open submission",
    "submission open",
    "future conference"
  ];


  return phrases.some(
    phrase =>
      q.includes(
        normalizeText(phrase)
      )
  );
}


// =====================================================
// CONFERENCE DATE SCORE
// =====================================================

function conferenceDateScore(
  item,
  question,
  analysis
) {
  if (!isConference(item)) {
    return 0;
  }


  const deadline =
    safeTime(
      getDeadline(item)
    );

  const start =
    safeTime(
      getStartDate(item)
    );

  const now =
    Date.now();

  const activeIntent =
    wantsActiveConference(
      question,
      analysis
    );


  let score = 0;


  if (deadline !== null) {
    const diffDays =
      (deadline - now) /
      86_400_000;


    if (diffDays >= 0) {
      // Still accepting submissions.
      score +=
        activeIntent
          ? 0.45
          : 0.12;


      // Mild preference for practical,
      // approaching deadlines.
      if (
        activeIntent &&
        diffDays <= 90
      ) {
        score +=
          Math.max(
            0,
            0.15 -
            diffDays / 600
          );
      }
    } else if (activeIntent) {
      score -= 0.7;
    }
  }


  if (
    activeIntent &&
    start !== null
  ) {
    if (start >= now) {
      score += 0.1;
    } else {
      score -= 0.3;
    }
  }


  return score;
}


// =====================================================
// QUARTILE SCORE
// =====================================================

function quartileScore(
  item,
  requestedQuartile
) {
  if (
    !requestedQuartile ||
    !isJournal(item)
  ) {
    return 0;
  }


  const quartiles =
    getQuartiles(item);


  if (!quartiles.length) {
    // Missing quartile is not negative evidence.
    return 0;
  }


  if (
    quartiles.includes(
      requestedQuartile
    )
  ) {
    return 0.75;
  }


  return -0.75;
}


// =====================================================
// COUNTRY SCORE
// =====================================================

function countryScore(
  item,
  requestedCountry
) {
  if (!requestedCountry) {
    return 0;
  }


  const country =
    getCountry(item);


  // Missing country is not negative evidence.
  if (
    !country &&
    !item?.location
  ) {
    return 0;
  }


  return countryMatches(
    item,
    requestedCountry
  )
    ? 0.5
    : -0.5;
}


// =====================================================
// FINAL SCORE ENGINE
// =====================================================

function computeFinalScore(
  item,
  {
    analysis,
    question,
    requestedQuartile,
    requestedCountry
  }
) {
  const baseScore =
    Number(
      item?.baseScore
    ) || 0;


  let score =
    baseScore;


  const fieldHint =
    getFieldHint(
      analysis
    );


  // Topic / field relevance
  if (fieldHint) {
    score +=
      fieldMatchScore(
        item,
        fieldHint
      );
  }


  // General lexical relevance
  score +=
    lexicalScore(
      item,
      question
    );


  // Quartile
  score +=
    quartileScore(
      item,
      requestedQuartile
    );


  // Country
  score +=
    countryScore(
      item,
      requestedCountry
    );


  // Conference timing
  score +=
    conferenceDateScore(
      item,
      question,
      analysis
    );


  return score;
}


// =====================================================
// DEDUPE
// =====================================================

function getIdentityKey(item) {
  // Prefer stable identifiers where available.
  const stableId =
    firstValue(
      item?._key,
      item?.u_key,
      item?.sourceid,
      item?.source_id
    );


  if (stableId) {
    return normalizeText(
      stableId
    );
  }


  if (isConference(item)) {
    const acronym =
      normalizeText(
        item?.acronym
      );

    const title =
      normalizeText(
        item?.name ||
        item?.title
      );

    const startDate =
      normalizeText(
        getStartDate(item)
      );


    return [
      "conference",
      acronym || title,
      startDate
    ]
      .filter(Boolean)
      .join("|");
  }


  const issn =
    normalizeText(
      firstValue(
        item?.primary_issn,
        item?.issn
      )
    );


  if (issn) {
    return `journal|${issn}`;
  }


  const title =
    normalizeText(
      item?.title ||
      item?.name
    );


  return (
    title
      ? `journal|${title}`
      : ""
  );
}


function dedupeKeepBest(
  items
) {
  const map =
    new Map();


  for (const item of items) {
    const key =
      getIdentityKey(item);


    if (!key) {
      continue;
    }


    const existing =
      map.get(key);


    if (
      !existing ||
      Number(item.score || 0) >
      Number(existing.score || 0)
    ) {
      map.set(
        key,
        item
      );
    }
  }


  return [
    ...map.values()
  ];
}


// =====================================================
// HARD CONSTRAINT FILTERS
// =====================================================

function applyCountryConstraint(
  items,
  requestedCountry
) {
  if (!requestedCountry) {
    return items;
  }


  const matched =
    items.filter(
      item =>
        countryMatches(
          item,
          requestedCountry
        )
    );


  /*
   * Country is an explicit user constraint.
   *
   * If matching records exist, use them exclusively.
   *
   * If none match, keep the original candidate pool so
   * the caller can still return semantically related
   * records rather than silently producing zero results.
   *
   * The scoring layer penalizes known mismatches.
   */
  return matched.length
    ? matched
    : items;
}


function applyQuartileConstraint(
  items,
  requestedQuartile
) {
  if (!requestedQuartile) {
    return items;
  }


  const journals =
    items.filter(isJournal);


  const nonJournals =
    items.filter(
      item =>
        !isJournal(item)
    );


  const exact =
    journals.filter(
      journal =>
        quartileMatches(
          journal,
          requestedQuartile
        )
    );


  /*
   * If Q1/Q2/Q3/Q4 is explicitly requested and exact
   * quartile matches exist, prefer those exact records.
   *
   * Do not interpret missing quartile as a mismatch.
   *
   * If no exact match exists, retain journals so the
   * generation layer can avoid false negative claims.
   */
  if (exact.length) {
    return [
      ...nonJournals,
      ...exact
    ];
  }


  return items;
}


// =====================================================
// COLLECTION SEARCH
// =====================================================

async function searchCollection(
  collection,
  vectors,
  topk
) {
  const tasks = [];


  for (
    let index = 0;
    index < vectors.length;
    index++
  ) {
    const vector =
      vectors[index];


    if (!vector) {
      continue;
    }


    // Original standalone query gets full weight.
    // Cleaned query is a secondary retrieval path.
    const weight =
      index === 0
        ? 1
        : 0.75;


    tasks.push(
      qdrant
        .search(
          collection,
          {
            vector,

            limit:
              Math.min(
                Math.max(
                  topk * 5,
                  20
                ),
                MAX_LIMIT
              ),

            with_payload:
              true
          }
        )
        .then(
          results =>
            results.map(
              result => ({
                ...result.payload,

                _qdrantCollection:
                  collection,

                _qdrantId:
                  result.id,

                baseScore:
                  Number(
                    result.score
                  ) *
                  weight
              })
            )
        )
        .catch(
          error => {
            console.error(
              `❌ Qdrant search ${collection}:`,
              error?.message ||
              error
            );

            return [];
          }
        )
    );
  }


  return (
    await Promise.all(tasks)
  ).flat();
}


// =====================================================
// CACHE
// =====================================================

function buildCacheKey(
  question,
  topk
) {
  return [
    normalizeText(question),
    Number(topk) || 10
  ].join("|");
}


function getCached(
  key
) {
  const cached =
    QUERY_CACHE.get(key);


  if (!cached) {
    return null;
  }


  if (
    Date.now() -
      cached.time >=
    QUERY_TTL
  ) {
    QUERY_CACHE.delete(key);

    return null;
  }


  return cached.value;
}


function setCache(
  key,
  value
) {
  QUERY_CACHE.set(
    key,
    {
      value,
      time:
        Date.now()
    }
  );


  // Prevent unlimited Map growth.
  if (
    QUERY_CACHE.size >
    500
  ) {
    const now =
      Date.now();


    for (
      const [
        cacheKey,
        cached
      ] of QUERY_CACHE
    ) {
      if (
        now -
          cached.time >=
        QUERY_TTL
      ) {
        QUERY_CACHE.delete(
          cacheKey
        );
      }
    }


    // Still too large: remove oldest insertion entries.
    while (
      QUERY_CACHE.size >
      500
    ) {
      const oldest =
        QUERY_CACHE
          .keys()
          .next()
          .value;

      if (!oldest) {
        break;
      }

      QUERY_CACHE.delete(
        oldest
      );
    }
  }
}


// =====================================================
// MAIN SEARCH
// =====================================================

export async function searchConferenceJournalByVector({
  question,
  topk = 10
}) {
  try {
    // =================================================
    // INPUT
    // =================================================

    const rawQuestion =
      String(
        question || ""
      ).trim();


    const safeTopK =
      Math.max(
        1,
        Math.min(
          Number(topk) || 10,
          MAX_LIMIT
        )
      );


    if (!rawQuestion) {
      return {
        domain: null,
        conferences: [],
        journals: []
      };
    }


    // =================================================
    // CACHE
    // =================================================

    const cacheKey =
      buildCacheKey(
        rawQuestion,
        safeTopK
      );


    const cached =
      getCached(
        cacheKey
      );


    if (cached) {
      return cached;
    }


    // =================================================
    // QUERY ANALYSIS
    // =================================================

    const cleaned =
      cleanQuery(
        rawQuestion
      );


    const domain =
      detectDomain(
        rawQuestion
      );


    const analysis =
      analyzeQuestion(
        rawQuestion
      ) || {};


    const requestedQuartile =
      extractQuartile(
        rawQuestion,
        analysis
      );


    const requestedCountry =
      extractCountry(
        analysis
      );


    console.log(
      "🔎 SCHOLAR SEARCH:",
      {
        domain,
        quartile:
          requestedQuartile ||
          null,
        country:
          requestedCountry ||
          null,
        field:
          getFieldHint(
            analysis
          ) ||
          null,
        topk:
          safeTopK
      }
    );


    // =================================================
    // COLLECTION SELECTION
    // =================================================

    const collections =
      domain === "conference"
        ? [
            "conference_vectors"
          ]
        : domain === "journal"
          ? [
              "journal_vectors"
            ]
          : [
              "conference_vectors",
              "journal_vectors"
            ];


    // =================================================
    // EMBEDDING
    // =================================================

    const embeddingInputs =
      rawQuestion === cleaned
        ? [
            rawQuestion
          ]
        : [
            rawQuestion,
            cleaned
          ];


    const vectors =
      await embedBatch(
        embeddingInputs
      );


    if (
      !Array.isArray(vectors) ||
      !vectors.length
    ) {
      return {
        domain,
        conferences: [],
        journals: []
      };
    }


    // =================================================
    // VECTOR SEARCH
    // =================================================

    const collectionTasks =
      collections.map(
        collection =>
          searchCollection(
            collection,
            vectors,
            safeTopK
          )
      );


    let results =
      (
        await Promise.all(
          collectionTasks
        )
      ).flat();


    if (!results.length) {
      const empty = {
        domain,
        conferences: [],
        journals: []
      };


      setCache(
        cacheKey,
        empty
      );


      return empty;
    }


    // =================================================
    // REMOVE WRONG RESOURCE TYPES EARLY
    // =================================================

    if (
      domain === "conference"
    ) {
      results =
        results.filter(
          isConference
        );
    } else if (
      domain === "journal"
    ) {
      results =
        results.filter(
          isJournal
        );
    }


    // =================================================
    // SCORE BEFORE HARD FILTERS
    // =================================================

    results =
      results.map(
        item => ({
          ...item,

          score:
            computeFinalScore(
              item,
              {
                analysis,
                question:
                  rawQuestion,
                requestedQuartile,
                requestedCountry
              }
            )
        })
      );


    // =================================================
    // DEDUPE
    //
    // Important:
    // same record may be returned from raw + cleaned
    // embeddings. Keep the highest-scoring version.
    // =================================================

    results =
      dedupeKeepBest(
        results
      );


    // =================================================
    // COUNTRY CONSTRAINT
    // =================================================

    results =
      applyCountryConstraint(
        results,
        requestedCountry
      );


    // =================================================
    // QUARTILE CONSTRAINT
    // =================================================

    if (
      domain !== "conference"
    ) {
      results =
        applyQuartileConstraint(
          results,
          requestedQuartile
        );
    }


    // =================================================
    // FINAL SORT
    // =================================================

    results.sort(
      (a, b) =>
        Number(
          b.score || 0
        ) -
        Number(
          a.score || 0
        )
    );


    // =================================================
    // SPLIT RESOURCE TYPES
    // =================================================

    const conferences = [];
    const journals = [];


    for (const item of results) {
      if (
        isConference(item)
      ) {
        conferences.push(
          item
        );

        continue;
      }


      if (
        isJournal(item)
      ) {
        journals.push(
          item
        );
      }
    }


    // =================================================
    // FINAL RESULT
    // =================================================

    const finalResult = {
      domain,

      conferences:
        domain === "journal"
          ? []
          : conferences.slice(
              0,
              safeTopK
            ),

      journals:
        domain === "conference"
          ? []
          : journals.slice(
              0,
              safeTopK
            )
    };


    console.log(
      "📊 SCHOLAR SEARCH RESULT:",
      {
        domain,
        conferences:
          finalResult
            .conferences
            .length,
        journals:
          finalResult
            .journals
            .length,
        quartile:
          requestedQuartile ||
          null,
        country:
          requestedCountry ||
          null
      }
    );


    // =================================================
    // CACHE RESULT
    // =================================================

    setCache(
      cacheKey,
      finalResult
    );


    return finalResult;

  } catch (error) {
    console.error(
      "❌ search fatal:",
      error
    );


    return {
      domain: null,
      conferences: [],
      journals: []
    };
  }
}