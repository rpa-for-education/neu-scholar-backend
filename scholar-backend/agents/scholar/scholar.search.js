// agents/scholar/scholar.search.js
import "dotenv/config";
import { qdrantClient as qdrant } from "../../db/qdrant.js";
import { getDb } from "../../db/mongo.js";
import { detectDomain, analyzeQuestion, countryMatches } from "./agentReasoning.js";
import { embedBatch } from "../shared/embedding.js";
import { callLLM } from "../shared/llm.js";

const MAX_LIMIT = 80;
const CACHE_TTL = 5 * 60 * 1000;
const resultCache = new Map();
const expansionCache = new Map();
let collectionNamesCache = null;

function text(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return text(value).toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value) {
  return text(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function first(...values) {
  return values.find(value => {
    if (value === null || value === undefined) return false;
    const result = text(value).toLowerCase();
    return result &&
      !["n/a", "null", "undefined"].includes(result);
  }) ?? "";
}

function titleOf(item, type) {
  return text(type === "journal"
    ? first(item.title, item.name, item.journal_title, item.source_title)
    : first(item.name, item.title, item.conference_name, item.event_name));
}

function itemQuartile(item) {
  const value = first(
    item.quartile,
    item.sjr_best_quartile,
    item.best_quartile
  );
  const match = text(value).match(/\bQ\s*([1-4])\b/i);
  return match ? `Q${match[1]}` : "";
}

function requestedQuartile(question) {
  const match = text(question).match(/\bQ\s*([1-4])\b/i);
  return match ? `Q${match[1]}` : "";
}

function resourceType(item) {
  if (
    item._qdrantCollection === "journal_vectors" ||
    normalize(item.type) === "journal"
  ) return "journal";

  if (
    item._qdrantCollection === "conference_vectors" ||
    normalize(item.type) === "conference"
  ) return "conference";

  return item.deadline || item.start_date ? "conference" : "journal";
}

function matchesCountry(item, target) {
  if (!target) return true;
  const values = [
    item.country,
    item.country_name,
    item.country_code,
    item.iso_code
  ].filter(Boolean);

  return !values.length ||
    values.some(value => countryMatches(value, target));
}

function identity(item, type) {
  return `${type}|${normalize(first(
    item.u_key,
    item._key,
    item.sourceid,
    item.source_id,
    type === "journal" ? item.issn : "",
    titleOf(item, type)
  ))}`;
}

function dedupe(items, type) {
  const found = new Map();

  for (const item of items) {
    if (!titleOf(item, type)) continue;
    const key = identity(item, type);
    const previous = found.get(key);

    if (
      !previous ||
      (Number(item.score) || 0) >
        (Number(previous.score) || 0)
    ) {
      found.set(key, item);
    }
  }

  return [...found.values()];
}

function searchTerms(question, expansion) {
  const words = expansion?.keywords?.length
    ? expansion.keywords
    : normalize(question)
        .split(" ")
        .filter(word => word.length >= 4);

  return [...new Set(
    words
      .map(normalize)
      .filter(word =>
        word.length >= 3 &&
        !/^(journal|conference|quartile|nghien cuu|tap chi|hoi thao|q[1-4])$/
          .test(word)
      )
  )].slice(0, 12);
}

export async function expandScholarQueries(question) {
  const original = text(question);
  const key = normalize(original);

  if (expansionCache.has(key)) {
    return expansionCache.get(key);
  }

  const fallback = {
    queries: [original],
    keywords: searchTerms(original)
  };

  try {
    const prompt = `Bạn là bộ mở rộng truy vấn tìm kiếm học thuật.

Viết lại câu hỏi bằng tiếng Việt và tiếng Anh để tìm CÙNG MỘT ý định.

Quy tắc:
- Giữ nguyên tên riêng, ISSN, quốc gia, năm, Q1–Q4 và điều kiện bắt buộc.
- Giữ nguyên loại tài nguyên: tạp chí, hội thảo hoặc cả hai.
- Không thêm điều kiện hoặc sự kiện không có trong câu gốc.
- Chỉ trả JSON hợp lệ, không kèm Markdown.
- Tối đa 3 queries và 8 keywords.

Định dạng:
{"queries":["câu tiếng Việt","English search query"],"keywords":["thuật ngữ tiếng Việt","English equivalent"]}

Câu hỏi:
${original}`;

    const response = await callLLM(prompt);
    const body = text(response?.answer)
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "");

    const parsed = JSON.parse(body);

    const queries = [
      original,
      ...(Array.isArray(parsed.queries) ? parsed.queries : [])
    ]
      .map(text)
      .filter(value => value.length >= 4 && value.length <= 250)
      .slice(0, 4);

    const keywords = (
      Array.isArray(parsed.keywords) ? parsed.keywords : []
    )
      .map(text)
      .filter(value => value.length >= 3 && value.length <= 80)
      .slice(0, 8);

    const expanded = {
      queries: [...new Set(queries)],
      keywords: keywords.length ? keywords : fallback.keywords
    };

    expansionCache.set(key, expanded);
    if (expansionCache.size > 300) {
      expansionCache.delete(expansionCache.keys().next().value);
    }
    return expanded;
  } catch (error) {
    console.warn(
      "Scholar query expansion:",
      error?.message || error
    );
    expansionCache.set(key, fallback);
    return fallback;
  }
}

function topicalScore(item, question, type, expansion) {
  const words = searchTerms(question, expansion);
  if (!words.length) return 0;

  const searchable = normalize([
    titleOf(item, type),
    item.areas,
    item.categories,
    item.fields,
    item.topics,
    item.cfp_text,
    item.description,
    item.text
  ].flat().filter(Boolean).join(" "));

  const hits = words.filter(word =>
    searchable.includes(normalize(word))
  ).length;

  return hits / words.length;
}

function itemScore(item, question, type, expansion) {
  return (Number(item.baseScore ?? item.score) || 0) +
    topicalScore(item, question, type, expansion) * 0.7;
}

function detailName(question) {
  const cleaned = text(question)
    .replace(/^[\s"“”']+|[\s"“”']+$/g, "");

  return cleaned.replace(
    /^(?:cho\s+(?:tôi|toi|mình|minh)\s+)?(?:biết\s+)?(?:thông tin\s+)?(?:chi tiết\s+)?(?:về\s+)?(?:hội thảo|tạp chí|conference|journal)\s*/iu,
    ""
  ).trim();
}

function isDetail(question) {
  return /\b(chi tiet|thong tin|gioi thieu|mo ta|details?|about)\b/
    .test(normalize(question));
}

async function vectorSearch(collection, vectors, count) {
  const batches = await Promise.all(
    vectors.map(async (vector, index) => {
      if (!vector) return [];

      try {
        const hits = await qdrant.search(collection, {
          vector,
          limit: count,
          with_payload: true
        });

        return hits.map(hit => ({
          ...(hit.payload || {}),
          _qdrantCollection: collection,
          _qdrantId: hit.id,
          baseScore:
            (Number(hit.score) || 0) *
            (index ? 0.85 : 1)
        }));
      } catch (error) {
        console.warn(
          "Scholar Qdrant:",
          error?.message || error
        );
        return [];
      }
    })
  );

  return batches.flat();
}

async function collectionNames(db, type) {
  if (!collectionNamesCache) {
    const names = (
      await db.listCollections(
        {},
        { nameOnly: true }
      ).toArray()
    ).map(item => item.name);

    collectionNamesCache = {
      journal: names.filter(name =>
        /journal|scimago/i.test(name) &&
        !/vector|embedding/i.test(name)
      ),
      conference: names.filter(name =>
        /conference|easychair/i.test(name) &&
        !/vector|embedding/i.test(name)
      )
    };
  }

  return collectionNamesCache[type] || [];
}

function lookupQuery(item, type) {
  const clauses = [];

  for (const key of [
    "u_key",
    "_key",
    "sourceid",
    "source_id"
  ]) {
    if (first(item[key])) {
      clauses.push({ [key]: item[key] });
    }
  }

  if (type === "journal" && first(item.issn)) {
    clauses.push({ issn: item.issn });
  }

  const name = titleOf(item, type);
  if (name) {
    clauses.push({
      [type === "journal" ? "title" : "name"]: name
    });
  }

  return clauses.length ? { $or: clauses } : null;
}

async function enrichFromMongo(db, items, type) {
  const names = await collectionNames(db, type);
  if (!names.length || !items.length) return items;

  return Promise.all(
    items.map(async item => {
      const query = lookupQuery(item, type);
      if (!query) return item;

      for (const name of names) {
        const full = await db.collection(name).findOne(query);

        if (full) {
          const { _id, ...data } = full;
          return {
            ...item,
            ...data,
            _qdrantCollection: item._qdrantCollection,
            baseScore: item.baseScore,
            score: item.score
          };
        }
      }
      return item;
    })
  );
}

async function mongoCandidates(
  db,
  question,
  type,
  quartile,
  expansion
) {
  const names = await collectionNames(db, type);
  if (!names.length) return [];

  const variants = searchTerms(question, expansion)
    .slice(0, 12);

  const fields = type === "journal"
    ? ["title", "areas", "categories", "description"]
    : ["name", "acronym", "topics", "cfp_text"];

  const topicClauses = variants.flatMap(value =>
    fields.map(field => ({
      [field]: {
        $regex: escapeRegex(value),
        $options: "i"
      }
    }))
  );

  const specificName = isDetail(question)
    ? detailName(question)
    : "";

  if (specificName.length >= 8) {
    topicClauses.unshift({
      [type === "journal" ? "title" : "name"]: {
        $regex: escapeRegex(specificName),
        $options: "i"
      }
    });
  }

  if (!topicClauses.length) return [];

  const query = { $or: topicClauses };

  if (quartile && type === "journal") {
    query.$and = [{
      $or: [
        { quartile },
        { sjr_best_quartile: quartile }
      ]
    }];
  }

  const batches = await Promise.all(
    names.map(async name => {
      const docs = await db.collection(name)
        .find(
          query,
          { projection: { _id: 0 } }
        )
        .limit(120)
        .toArray();

      return docs.map(doc => ({
        ...doc,
        baseScore: 0,
        _mongoCollection: name
      }));
    })
  );

  return batches.flat();
}

export async function searchConferenceJournalByVector({
  question,
  topk = 10
}) {
  const original = text(question);
  const limit = Math.max(
    1,
    Math.min(Math.trunc(Number(topk)) || 10, MAX_LIMIT)
  );

  if (!original) {
    return {
      domain: "general",
      conferences: [],
      journals: []
    };
  }

  const cacheKey = `${normalize(original)}|${limit}`;
  const cached = resultCache.get(cacheKey);

  if (
    cached &&
    Date.now() - cached.time < CACHE_TTL
  ) {
    return cached.value;
  }

  const domain = detectDomain(original);
  const analysis = analyzeQuestion(original) || {};
  const quartile = requestedQuartile(original);
  const targetCountry = analysis.wantsCountryCode;

  const types = domain === "journal"
    ? ["journal"]
    : domain === "conference"
      ? ["conference"]
      : ["conference", "journal"];

  try {
    const expansion =
      await expandScholarQueries(original);

    const vectors = await embedBatch(
      expansion.queries
    );

    let db = null;
    try {
      db = await getDb();
    } catch (error) {
      console.warn(
        "Scholar Mongo unavailable:",
        error?.message || error
      );
    }

    const output = {
      domain,
      conferences: [],
      journals: []
    };

    for (const type of types) {
      const collection = type === "journal"
        ? "journal_vectors"
        : "conference_vectors";

      let items = await vectorSearch(
        collection,
        Array.isArray(vectors) ? vectors : [],
        MAX_LIMIT
      );

      items = items.filter(item =>
        resourceType(item) === type
      );

      if (db) {
        try {
          items = await enrichFromMongo(
            db,
            items,
            type
          );
          items.push(
            ...await mongoCandidates(
              db,
              original,
              type,
              quartile,
              expansion
            )
          );
        } catch (error) {
          console.warn(
            `Scholar Mongo ${type}:`,
            error?.message || error
          );
        }
      }

      items = dedupe(
        items.map(item => ({
          ...item,
          score: itemScore(
            item,
            original,
            type,
            expansion
          )
        })),
        type
      ).filter(item =>
        matchesCountry(item, targetCountry)
      );

      if (quartile && type === "journal") {
        items = items.filter(item =>
          itemQuartile(item) === quartile
        );
      }

      items.sort((a, b) => b.score - a.score);

      output[
        type === "journal"
          ? "journals"
          : "conferences"
      ] = items.slice(0, limit);
    }

    resultCache.set(cacheKey, {
      value: output,
      time: Date.now()
    });

    if (resultCache.size > 300) {
      resultCache.delete(
        resultCache.keys().next().value
      );
    }

    return output;
  } catch (error) {
    console.error(
      "Scholar search fatal:",
      error
    );

    return {
      domain,
      conferences: [],
      journals: []
    };
  }
}