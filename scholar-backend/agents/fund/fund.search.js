// agents/fund/fund.search.js
import "dotenv/config";
import { embed } from "../shared/embedding.js";
import { qdrantClient } from "../../db/qdrant.js";
import { getDb } from "../../db/mongo.js";
import { detectIntent } from "./agentReasoning.js";
import { COUNTRY_NAME_TO_ISO } from "../../services/scripts/country_iso_full.js";
import { COUNTRY_VI_TO_ISO } from "../../services/scripts/country_vi_alias.js";

const COLLECTION =
  process.env.QDRANT_COLLECTION_FUND || "fund_vectors";
const CACHE_TTL = 300000;
const EMBED_TTL = 1800000;
const MAX_CACHE = 500;
const SEARCH_TIMEOUT =
  Number(process.env.FUND_SEARCH_TIMEOUT_MS) || 1800;
const EMBED_TIMEOUT =
  Number(process.env.FUND_EMBED_TIMEOUT_MS) || 1500;
const CACHE = new Map();
const EMBED_CACHE = new Map();

const FIELDS = [
  "opportunity_title",
  "title",
  "name",
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

const STOP = new Set([
  "cho", "toi", "tim", "kiem", "cac", "mot",
  "nhung", "tai", "trong", "voi", "cua",
  "ve", "quy", "tro", "fund", "grant",
  "for", "the", "and"
]);

function text(value) {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean).join(" ");
  }
  if (typeof value === "object") {
    return Object.values(value)
      .map(text)
      .filter(Boolean)
      .join(" ");
  }
  return String(value);
}
function norm(value) {
  return text(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function first(...values) {
  return values.find(value => {
    const result = text(value).trim().toLowerCase();
    return result &&
      !["n/a", "na", "null", "undefined"]
        .includes(result);
  }) ?? "";
}
function tokens(value) {
  return [...new Set(
    norm(value)
      .split(" ")
      .filter(word =>
        word.length >= 3 && !STOP.has(word)
      )
  )];
}
function cacheGet(cache, key, ttl) {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.time >= ttl) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}
function cacheSet(cache, key, value) {
  cache.set(key, {
    value,
    time: Date.now()
  });
  while (cache.size > MAX_CACHE) {
    cache.delete(cache.keys().next().value);
  }
}
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("search timeout")),
        ms
      );
    })
  ]).finally(() => clearTimeout(timer));
}

// Dùng hai bảng quốc gia đầy đủ của dự án.
const COUNTRY_CODES = new Map();

for (const [name, iso] of [
  ...Object.entries(COUNTRY_VI_TO_ISO || {}),
  ...Object.entries(COUNTRY_NAME_TO_ISO || {})
]) {
  const code = String(iso ?? "").trim().toUpperCase();
  if (code) {
    COUNTRY_CODES.set(norm(name), code);
    COUNTRY_CODES.set(norm(code), code);
  }
}
for (const [name, code] of Object.entries({
  vietnam: "VN",
  "viet nam": "VN",
  vn: "VN",
  usa: "US",
  "united states": "US",
  "united states of america": "US",
  us: "US",
  america: "US",
  uk: "GB",
  "united kingdom": "GB"
})) {
  COUNTRY_CODES.set(norm(name), code);
}
function countryCode(value) {
  return COUNTRY_CODES.get(norm(value)) || "";
}
function countryState(payload, intent) {
  const wanted = intent.country === "vietnam"
    ? "VN"
    : intent.country === "usa"
      ? "US"
      : intent.country || "";

  if (!wanted) return "unknown";

  const values = [
    payload.country,
    payload.country_name,
    payload.country_code,
    payload.location_country,
    payload.nation
  ].filter(Boolean);

  if (!values.length) return "unknown";

  const expected =
    countryCode(wanted) || wanted.toUpperCase();
  const recognized = values
    .map(countryCode)
    .filter(Boolean);

  if (!recognized.length) return "unknown";

  return recognized.includes(expected)
    ? "match"
    : "mismatch";
}
function normalizeFund(doc = {}) {
  const item =
    doc && typeof doc === "object" ? doc : {};

  return {
    ...item,
    title: first(
      item.opportunity_title,
      item.title,
      item.name,
      item.program_title
    ),
    agency: first(
      item.agency_name,
      item.agency,
      item.funding_agency,
      item.organization
    ),
    opportunity_id: first(
      item.opportunity_id,
      item.id,
      item.opportunity_identifier
    ),
    opportunity_number: first(
      item.opportunity_number,
      item.funding_opportunity_number,
      item.foa_number
    ),
    category: first(
      item.category,
      item.funding_categories,
      item.funding_category,
      item.research_area
    ),
    summary_description: first(
      item.summary_description,
      item.description,
      item.summary,
      item.text
    ),
    deadline: first(
      item.close_date,
      item.deadline,
      item.application_deadline,
      item.submission_deadline
    ),
    funding_amount: first(
      item.funding_amount,
      item.estimated_total_program_funding,
      item.amount,
      item.total_funding
    ),
    award_ceiling: first(
      item.award_ceiling,
      item.maximum_award,
      item.max_award
    ),
    award_floor: first(
      item.award_floor,
      item.minimum_award,
      item.min_award
    ),
    url: first(
      item.url,
      item.link,
      item.opportunity_url,
      item.additional_info_url,
      item.website,
      item.homepage,
      item["OPPORTUNITY URL"]
    )
  };
}
function searchable(payload) {
  return norm([
    payload.title,
    payload.agency,
    payload.top_level_agency_name,
    payload.category,
    payload.funding_category_description,
    payload.summary_description,
    payload.applicant_types,
    payload.applicant_eligibility_description,
    payload.keywords,
    payload.country,
    payload.opportunity_number
  ]);
}
function lexical(payload, query) {
  const words = tokens(query);
  const haystack = searchable(payload);
  if (!words.length || !haystack) return 0;

  return words.filter(word =>
    haystack.includes(word)
  ).length / words.length;
}
function fundYears(payload) {
  const years = new Set();

  for (const value of [
    payload.fiscal_year,
    payload.fy,
    payload.year,
    payload.call_year,
    payload.deadline,
    payload.close_date,
    payload.post_date
  ]) {
    const matches = text(value).match(/\b20\d{2}\b/g);
    if (matches) {
      matches.forEach(year =>
        years.add(Number(year))
      );
    }
  }
  return years;
}
function deadlineScore(payload, query) {
  if (!/(con han|dang mo|sap toi|deadline|han nop|open|upcoming)/
    .test(norm(query))) return 0;

  const raw = first(
    payload.deadline,
    payload.close_date
  );
  if (!raw) return 0;

  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(String(raw))
      ? `${raw}T23:59:59Z`
      : raw
  ).getTime();

  if (!Number.isFinite(date)) return 0;
  return date >= Date.now() ? 0.12 : -0.4;
}
function scoreResult(result, query, intent) {
  const payload = result.payload;
  const base = Number(result.score) || 0;
  const relevance = lexical(payload, query);

  let score =
    Math.max(0, base) * 0.6 +
    relevance * 0.4 +
    deadlineScore(payload, query);

  if (intent.year) {
    const years = fundYears(payload);
    if (years.has(intent.year)) {
      score += 0.25;
    } else if (years.size) {
      score -= 0.1;
    }
  }

  const country = countryState(payload, intent);
  if (country === "match") score += 0.25;
  if (country === "mismatch") score -= 0.3;

  const q = norm(query);
  const source = searchable(payload);

  for (const name of [
    "nafosted", "nsf", "nih", "erc", "horizon europe"
  ]) {
    if (
      q.includes(name) &&
      source.includes(name)
    ) {
      score += 0.3;
    }
  }

  return {
    ...result,
    score,
    baseScore: base,
    lexicalScore: relevance
  };
}
function identity(result) {
  const payload = result.payload || {};
  const id = first(
    payload._key,
    payload.u_key,
    payload.opportunity_id,
    payload.opportunity_number,
    payload.source_id
  );
  return norm(
    id || `${payload.title}|${payload.agency}`
  );
}
function merge(vectorResults, keywordResults) {
  const found = new Map();

  for (const result of [
    ...vectorResults,
    ...keywordResults
  ]) {
    const key = identity(result);
    if (!key) continue;
    const previous = found.get(key);
    if (
      !previous ||
      Number(result.score) > Number(previous.score)
    ) {
      found.set(key, result);
    }
  }
  return [...found.values()];
}
async function vectorSearch(vector, limit) {
  if (!vector) return [];

  try {
    const hits = await withTimeout(
      qdrantClient.search(COLLECTION, {
        vector,
        limit: Math.min(
          Math.max(limit * 5, 20),
          50
        ),
        with_payload: true,
        score_threshold: 0.05
      }),
      SEARCH_TIMEOUT
    );

    return hits.map(hit => ({
      id: hit.id,
      payload: normalizeFund(
        hit.payload || {}
      ),
      score: Number(hit.score) || 0
    }));
  } catch (error) {
    console.warn(
      "Fund vector search failed:",
      error?.message || error
    );
    return [];
  }
}
async function keywordSearch(query, limit) {
  const words = tokens(query).slice(0, 12);
  if (!words.length) return [];

  try {
    const db = await getDb();

    // Escape regex để từ khóa người dùng được tìm
    // như văn bản, không trở thành biểu thức regex.
    const conditions = words.flatMap(word =>
      FIELDS.map(field => ({
        [field]: {
          $regex: word.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          ),
          $options: "i"
        }
      }))
    );

    const docs = await withTimeout(
      db.collection("fund")
        .find({ $or: conditions })
        .limit(
          Math.min(
            Math.max(limit * 3, 20),
            60
          )
        )
        .toArray(),
      SEARCH_TIMEOUT
    );

    return docs
      .map(doc => {
        const payload = normalizeFund(doc);
        return {
          id: String(
            doc._id ||
            doc.u_key ||
            doc.opportunity_id ||
            ""
          ),
          payload,
          score:
            0.15 +
            lexical(payload, query) * 0.5
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch (error) {
    console.warn(
      "Fund keyword search failed:",
      error?.message || error
    );
    return [];
  }
}

export async function searchFund(
  query,
  topk = 5
) {
  const raw = String(query ?? "").trim();
  if (!raw) return [];

  const limit = Math.min(
    Math.max(
      Math.trunc(Number(topk)) || 5,
      1
    ),
    50
  );
  const intent = detectIntent(raw);
  const key = `${norm(raw)}|${limit}`;

  const cached = cacheGet(
    CACHE,
    key,
    CACHE_TTL
  );
  if (cached) return cached;

  let vector = cacheGet(
    EMBED_CACHE,
    norm(raw),
    EMBED_TTL
  );

  if (!vector) {
    try {
      vector = await withTimeout(
        embed(raw),
        EMBED_TIMEOUT
      );
      if (vector) {
        cacheSet(
          EMBED_CACHE,
          norm(raw),
          vector
        );
      }
    } catch (error) {
      console.warn(
        "Fund embedding failed:",
        error?.message || error
      );
    }
  }

  const [semantic, keyword] = await Promise.all([
    vectorSearch(vector, limit),
    keywordSearch(
      raw,
      Math.min(limit * 4, 60)
    )
  ]);

  let ranked = merge(
    semantic,
    keyword
  ).map(result =>
    scoreResult(result, raw, intent)
  );

  // Chỉ loại khi trường quốc gia chứng minh
  // rõ kết quả thuộc quốc gia khác.
  if (intent.country) {
    ranked = ranked.filter(result =>
      countryState(
        result.payload,
        intent
      ) !== "mismatch"
    );
  }

  // Nếu có đủ kết quả đúng năm, ưu tiên
  // tập kết quả đó.
  if (intent.year) {
    const exact = ranked.filter(result =>
      fundYears(result.payload)
        .has(intent.year)
    );
    if (exact.length >= limit) {
      ranked = exact;
    }
  }

  ranked.sort((a, b) =>
    b.score - a.score
  );

  const output = ranked
    .slice(0, limit)
    .map(result => ({
      ...result,
      payload: {
        ...result.payload
      }
    }));

  cacheSet(
    CACHE,
    key,
    output
  );
  return output;
}