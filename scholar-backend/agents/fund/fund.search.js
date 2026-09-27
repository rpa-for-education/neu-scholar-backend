// agents/fund/fund.search.js
import "dotenv/config";
import { embed } from "../shared/embedding.js";
import { callLLM } from "../shared/llm.js";
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
  Number(process.env.FUND_SEARCH_TIMEOUT_MS) || 8000;
const EMBED_TIMEOUT =
  Number(process.env.FUND_EMBED_TIMEOUT_MS) || 6000;

const CACHE = new Map();
const EMBED_CACHE = new Map();
const EXPANSION_CACHE = new Map();

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

function normalize(value) {
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
      !["n/a", "na", "null", "undefined"].includes(result);
  }) ?? "";
}

function tokens(value) {
  return [...new Set(
    normalize(value)
      .split(" ")
      .filter(word =>
        word.length >= 3 &&
        !STOP.has(word)
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
    cache.delete(
      cache.keys().next().value
    );
  }
}

function withTimeout(promise, ms) {
  let timer;

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(
          new Error("search timeout")
        ),
        ms
      );
    })
  ]).finally(
    () => clearTimeout(timer)
  );
}

/**
 * Tạo cách diễn đạt Việt–Anh cho cùng một nhu cầu tài trợ.
 * Nếu LLM lỗi, tìm bằng nguyên câu hỏi.
 */
export async function expandFundQueries(query) {
  const original = text(query).trim();
  const key = normalize(original);

  if (EXPANSION_CACHE.has(key)) {
    return EXPANSION_CACHE.get(key);
  }

  const fallback = {
    queries: [original],
    keywords: []
  };

  try {
    const prompt = `Bạn là bộ mở rộng truy vấn tìm kiếm quỹ nghiên cứu.

Viết cách diễn đạt tiếng Việt và tiếng Anh cho CÙNG MỘT yêu cầu.

Quy tắc:
- Giữ nguyên tên riêng, quốc gia, năm, ngành, mã chương trình.
- Giữ nguyên đối tượng được hỏi: nghiên cứu sinh, cá nhân, nhóm hay tổ chức.
- Không thêm điều kiện không có trong câu gốc.
- Chỉ trả JSON hợp lệ, không có Markdown.
- Tối đa 3 queries và 8 keywords.

Định dạng:
{"queries":["câu tiếng Việt","English query"],"keywords":["thuật ngữ Việt","English equivalent"]}

Câu hỏi:
${original}`;

    const response =
      await callLLM(prompt);

    const body = text(response?.answer)
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "");

    const parsed = JSON.parse(body);

    const queries = [
      original,
      ...(Array.isArray(parsed.queries)
        ? parsed.queries
        : [])
    ]
      .map(text)
      .map(value => value.trim())
      .filter(value =>
        value.length >= 4 &&
        value.length <= 250
      )
      .slice(0, 4);

    const keywords = (
      Array.isArray(parsed.keywords)
        ? parsed.keywords
        : []
    )
      .map(text)
      .map(value => value.trim())
      .filter(value =>
        value.length >= 3 &&
        value.length <= 80
      )
      .slice(0, 8);

    const result = {
      queries: [...new Set(queries)],
      keywords
    };

    EXPANSION_CACHE.set(key, result);

    if (
      EXPANSION_CACHE.size >
      MAX_CACHE
    ) {
      EXPANSION_CACHE.delete(
        EXPANSION_CACHE.keys()
          .next().value
      );
    }

    return result;
  } catch (error) {
    console.warn(
      "Fund query expansion:",
      error?.message || error
    );

    EXPANSION_CACHE.set(
      key,
      fallback
    );

    return fallback;
  }
}

const COUNTRY_CODES = new Map();

for (const [name, iso] of [
  ...Object.entries(
    COUNTRY_VI_TO_ISO || {}
  ),
  ...Object.entries(
    COUNTRY_NAME_TO_ISO || {}
  )
]) {
  const code = String(iso ?? "")
    .trim()
    .toUpperCase();

  if (code) {
    COUNTRY_CODES.set(
      normalize(name),
      code
    );
    COUNTRY_CODES.set(
      normalize(code),
      code
    );
  }
}

for (
  const [name, code] of
  Object.entries({
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
  })
) {
  COUNTRY_CODES.set(
    normalize(name),
    code
  );
}

function countryCode(value) {
  return COUNTRY_CODES.get(
    normalize(value)
  ) || "";
}

function countryState(payload, intent) {
  const wanted =
    intent.country === "vietnam"
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

  if (!values.length) {
    return "unknown";
  }

  const expected =
    countryCode(wanted) ||
    wanted.toUpperCase();

  const recognized = values
    .map(countryCode)
    .filter(Boolean);

  if (!recognized.length) {
    return "unknown";
  }

  return recognized.includes(expected)
    ? "match"
    : "mismatch";
}

function normalizeFund(doc = {}) {
  const item =
    doc && typeof doc === "object"
      ? doc
      : {};

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
  return normalize([
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

  if (
    !words.length ||
    !haystack
  ) return 0;

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
    const matches = text(value)
      .match(/\b20\d{2}\b/g);

    if (matches) {
      matches.forEach(year =>
        years.add(Number(year))
      );
    }
  }

  return years;
}

function deadlineScore(payload, query) {
  if (
    !/(con han|dang mo|sap toi|deadline|han nop|open|upcoming)/
      .test(normalize(query))
  ) return 0;

  const raw = first(
    payload.deadline,
    payload.close_date
  );

  if (!raw) return 0;

  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/
      .test(String(raw))
      ? `${raw}T23:59:59Z`
      : raw
  ).getTime();

  if (!Number.isFinite(date)) {
    return 0;
  }

  return date >= Date.now()
    ? 0.12
    : -0.4;
}

function scoreResult(result, query, intent) {
  const payload = result.payload;
  const base =
    Number(result.score) || 0;
  const relevance =
    lexical(payload, query);

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

  const country =
    countryState(payload, intent);

  if (country === "match") {
    score += 0.25;
  }

  if (country === "mismatch") {
    score -= 0.3;
  }

  const q = normalize(query);
  const source = searchable(payload);

  for (const name of [
    "nafosted",
    "nsf",
    "nih",
    "erc",
    "horizon europe"
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
  const payload =
    result.payload || {};

  const id = first(
    payload._key,
    payload.u_key,
    payload.opportunity_id,
    payload.opportunity_number,
    payload.source_id
  );

  return normalize(
    id ||
    `${payload.title}|${payload.agency}`
  );
}

function merge(
  vectorResults,
  keywordResults
) {
  const found = new Map();

  for (const result of [
    ...vectorResults,
    ...keywordResults
  ]) {
    const key =
      identity(result);

    if (!key) continue;

    const previous =
      found.get(key);

    if (!previous) {
      found.set(key, result);
      continue;
    }

    const preferred =
      Number(result.score) >
      Number(previous.score)
        ? result
        : previous;

    const other =
      preferred === result
        ? previous
        : result;

    found.set(key, {
      ...preferred,
      payload: normalizeFund({
        ...other.payload,
        ...Object.fromEntries(
          Object.entries(
            preferred.payload
          ).filter(([, value]) =>
            value !== "" &&
            value != null
          )
        )
      })
    });
  }

  return [...found.values()];
}

async function hydrate(result, db) {
  const payload =
    result.payload || {};
  const conditions = [];

  if (payload.opportunity_id) {
    conditions.push({
      opportunity_id:
        payload.opportunity_id
    });
  }

  if (
    payload.opportunity_number
  ) {
    conditions.push({
      opportunity_number:
        payload.opportunity_number
    });
  }

  const title = first(
    payload.opportunity_title,
    payload.title
  );

  if (title) {
    const escaped =
      String(title).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    for (const key of [
      "opportunity_title",
      "title"
    ]) {
      conditions.push({
        [key]: {
          $regex: `^${escaped}$`,
          $options: "i"
        }
      });
    }
  }

  if (!conditions.length) {
    return result;
  }

  try {
    const full = await withTimeout(
      db.collection("fund")
        .findOne({
          $or: conditions
        }),
      SEARCH_TIMEOUT
    );

    if (!full) return result;

    const merged = {
      ...payload,
      ...Object.fromEntries(
        Object.entries(full)
          .filter(([, value]) =>
            value !== "" &&
            value != null
          )
      )
    };

    return {
      ...result,
      payload:
        normalizeFund(merged)
    };
  } catch (error) {
    console.warn(
      "Fund hydration failed:",
      error?.message || error
    );
    return result;
  }
}

async function vectorSearch(
  vector,
  limit
) {
  if (!vector) return [];

  try {
    const hits = await withTimeout(
      qdrantClient.search(
        COLLECTION,
        {
          vector,
          limit: Math.min(
            Math.max(
              limit * 5,
              20
            ),
            50
          ),
          with_payload: true,
          score_threshold: 0.05
        }
      ),
      SEARCH_TIMEOUT
    );

    return hits.map(hit => ({
      id: hit.id,
      payload: normalizeFund(
        hit.payload || {}
      ),
      score:
        Number(hit.score) || 0
    }));
  } catch (error) {
    console.warn(
      "Fund vector search failed:",
      error?.message || error
    );
    return [];
  }
}

async function keywordSearch(
  query,
  limit,
  expansion = {
    keywords: []
  }
) {
  const words = [
    ...new Set([
      ...tokens(query),
      ...expansion.keywords
        .flatMap(tokens)
    ])
  ].slice(0, 18);

  if (!words.length) {
    return [];
  }

  try {
    const db = await getDb();

    const conditions =
      words.flatMap(word =>
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
        .find({
          $or: conditions
        })
        .limit(
          Math.min(
            Math.max(
              limit * 3,
              20
            ),
            60
          )
        )
        .toArray(),
      SEARCH_TIMEOUT
    );

    return docs
      .map(doc => {
        const payload =
          normalizeFund(doc);

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
            lexical(
              payload,
              query
            ) * 0.5
        };
      })
      .sort((a, b) =>
        b.score - a.score
      )
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
  const original =
    String(query ?? "").trim();

  if (!original) return [];

  const limit = Math.min(
    Math.max(
      Math.trunc(
        Number(topk)
      ) || 5,
      1
    ),
    50
  );

  const intent =
    detectIntent(original);

  const key =
    `${normalize(original)}|${limit}`;

  const cached =
    cacheGet(
      CACHE,
      key,
      CACHE_TTL
    );

  if (cached) return cached;

  const expansion =
    await expandFundQueries(
      original
    );

  const vectors =
    await Promise.all(
      expansion.queries
        .slice(0, 3)
        .map(async candidate => {
          const vectorKey =
            normalize(candidate);

          const cachedVector =
            cacheGet(
              EMBED_CACHE,
              vectorKey,
              EMBED_TTL
            );

          if (cachedVector) {
            return cachedVector;
          }

          try {
            const vector =
              await withTimeout(
                embed(candidate),
                Math.max(
                  EMBED_TIMEOUT,
                  6000
                )
              );

            if (vector) {
              cacheSet(
                EMBED_CACHE,
                vectorKey,
                vector
              );
            }

            return vector;
          } catch (error) {
            console.warn(
              "Fund embedding failed:",
              error?.message || error
            );
            return null;
          }
        })
    );

  const [
    semanticBatches,
    keyword
  ] = await Promise.all([
    Promise.all(
      vectors.map(vector =>
        vectorSearch(
          vector,
          limit
        )
      )
    ),
    keywordSearch(
      original,
      Math.min(
        limit * 4,
        60
      ),
      expansion
    )
  ]);

  const semantic =
    semanticBatches.flat();

  let ranked = merge(
    semantic,
    keyword
  ).map(result =>
    scoreResult(
      result,
      original,
      intent
    )
  );

  if (intent.country) {
    ranked = ranked.filter(
      result =>
        countryState(
          result.payload,
          intent
        ) !== "mismatch"
    );
  }

  if (intent.year) {
    const exact =
      ranked.filter(result =>
        fundYears(
          result.payload
        ).has(intent.year)
      );

    if (
      exact.length >= limit
    ) {
      ranked = exact;
    }
  }

  ranked.sort(
    (a, b) =>
      b.score - a.score
  );

  // Qdrant có thể chỉ lưu ít trường.
  // Lấy bản ghi MongoDB đầy đủ.
  let output =
    ranked.slice(0, limit);

  try {
    const db =
      await getDb();

    output =
      await Promise.all(
        output.map(result =>
          hydrate(
            result,
            db
          )
        )
      );
  } catch (error) {
    console.warn(
      "Fund detail hydration unavailable:",
      error?.message || error
    );
  }

  output = output.map(
    result => ({
      ...result,
      payload: {
        ...result.payload
      }
    })
  );

  cacheSet(
    CACHE,
    key,
    output
  );

  return output;
}