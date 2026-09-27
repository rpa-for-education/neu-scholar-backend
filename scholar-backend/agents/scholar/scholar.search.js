// agents/scholar/scholar.search.js
import "dotenv/config";
import { qdrantClient as qdrant } from "../../db/qdrant.js";
import { detectDomain, analyzeQuestion, countryMatches } from "./agentReasoning.js";
import { embedBatch } from "../shared/embedding.js";

const MAX_LIMIT = 80;
const QUERY_TTL = 5 * 60 * 1000;
const QUERY_CACHE = new Map();
const STOP_WORDS = new Set([
  "cho", "toi", "tim", "kiem", "ve", "thuoc", "trong", "linh", "vuc",
  "cac", "nhung", "mot", "so", "va", "hoac", "tai", "cua", "con",
  "thi", "sao", "nao", "giup", "thong", "tin", "chi", "tiet",
  "tap", "journal", "journals", "hoi", "thao", "conference", "conferences",
  "find", "show", "give", "me", "about", "for", "in", "on", "the",
  "and", "or", "q1", "q2", "q3", "q4"
]);
function normalize(value) {
  return String(value ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function cleanQuery(value) {
  return String(value ?? "").toLowerCase().normalize("NFC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function toText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(" ");
  if (typeof value === "object") {
    return Object.values(value).map(toText).filter(Boolean).join(" ");
  }
  return normalize(value);
}
function first(...values) {
  return values.find(value => {
    if (value == null) return false;
    const result = String(value).trim().toLowerCase();
    return result && !["n/a", "na", "null", "undefined"].includes(result);
  }) ?? "";
}
function countryState(item, target) {
  const values = [
    item.country, item.country_name, item.location_country,
    item.nation, item.country_code, item.iso_code
  ].filter(Boolean);
  if (!values.length) return "unknown";
  return values.some(value => countryMatches(value, target))
    ? "match" : "mismatch";
}
function quartile(value) {
  const match = String(value ?? "").match(/\bQ\s*([1-4])\b/i);
  return match ? `Q${match[1]}` : "";
}
function itemQuartile(item) {
  return quartile(first(
    item.quartile, item.sjr_best_quartile,
    item.best_quartile, item.sjr_quartile, item.q
  ));
}
function requestedQuartile(question, analysis) {
  for (const value of [
    analysis?.quartile, analysis?.wantsQuartile,
    analysis?.quartileHint, analysis?.targetQuartile, question
  ]) {
    const found = quartile(value);
    if (found) return found;
  }
  return "";
}
function resourceType(item) {
  const explicit = normalize(first(
    item.type, item.resource_type, item.resourceType, item.kind
  ));
  if (explicit === "conference" || explicit === "journal") return explicit;
  if (item._qdrantCollection === "conference_vectors") return "conference";
  if (item._qdrantCollection === "journal_vectors") return "journal";
  const conferenceSignals = [
    item.deadline, item.start_date, item.end_date,
    item.acronym, item.cfp_text
  ].filter(Boolean).length;
  const journalSignals = [
    item.quartile, item.sjr_best_quartile, item.sjr,
    item.h_index, item.issn, item.publisher
  ].filter(Boolean).length;
  return conferenceSignals > journalSignals ? "conference" : "journal";
}
function searchableText(item) {
  const keys = resourceType(item) === "conference"
    ? [
        "name", "title", "conference_name", "event_name", "acronym",
        "topics", "topic", "fields", "field", "categories", "category",
        "areas", "area", "subjects", "keywords", "cfp_text", "cfp",
        "description", "text", "location", "city", "country"
      ]
    : [
        "title", "name", "journal_title", "source_title",
        "publisher", "publisher_name", "categories", "category",
        "areas", "area", "fields", "field", "subjects", "topics",
        "text", "description", "country", "region", "issn", "primary_issn"
      ];
  return keys.map(key => toText(item[key])).filter(Boolean).join(" ");
}
function tokens(value) {
  return [...new Set(
    normalize(value).split(/\s+/).filter(
      word => word.length >= 2 && !STOP_WORDS.has(word)
    )
  )];
}
function lexicalScore(item, question) {
  const haystack = searchableText(item);
  const words = tokens(question);
  if (!haystack || !words.length) return 0;
  const overlap = words.filter(word => haystack.includes(word)).length / words.length;
  const phrase = normalize(question);
  return Math.min(
    overlap * 0.45 +
    (phrase.length >= 4 && haystack.includes(phrase) ? 0.25 : 0),
    0.7
  );
}
function fieldScore(item, hint) {
  const field = normalize(hint);
  const words = tokens(field);
  const haystack = searchableText(item);
  if (!field || !words.length || !haystack) return 0;
  const overlap = words.filter(word => haystack.includes(word)).length / words.length;
  return Math.min(
    (haystack.includes(field) ? 0.35 : 0) + overlap * 0.35,
    0.7
  );
}
function dateValue(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}
function wantsUpcoming(question, analysis) {
  if (
    analysis?.wantsOpen || analysis?.wantsUpcoming ||
    analysis?.futureOnly || analysis?.activeOnly
  ) return true;
  const q = normalize(question);
  return [
    "con han", "con deadline", "con mo", "dang mo",
    "sap toi", "upcoming", "open submission", "submission open"
  ].some(phrase => q.includes(phrase));
}
function dateScore(item, question, analysis) {
  if (resourceType(item) !== "conference") return 0;
  const deadline = dateValue(first(
    item.deadline, item.submission_deadline,
    item.paper_deadline, item.cfp_deadline, item.close_date
  ));
  const start = dateValue(first(
    item.start_date, item.event_date, item.conference_date, item.date
  ));
  const active = wantsUpcoming(question, analysis);
  const now = Date.now();
  let score = 0;
  if (deadline !== null) {
    const days = (deadline - now) / 86400000;
    if (days >= 0) {
      score += active ? 0.45 : 0.12;
      if (active && days <= 90) {
        score += Math.max(0, 0.15 - days / 600);
      }
    } else if (active) {
      score -= 0.7;
    }
  }
  if (active && start !== null) {
    score += start >= now ? 0.1 : -0.3;
  }
  return score;
}
function scoreItem(item, question, analysis, targetQuartile, targetCountry) {
  let score = Number(item.baseScore) || 0;
  score += lexicalScore(item, question);
  const hint = first(
    analysis?.fieldHint, analysis?.field,
    analysis?.topic, analysis?.topicHint, analysis?.keywords
  );
  if (hint) score += fieldScore(item, hint);
  if (targetCountry) {
    const state = countryState(item, targetCountry);
    if (state !== "unknown") {
      score += state === "match" ? 0.5 : -0.5;
    }
  }
  if (targetQuartile && resourceType(item) === "journal") {
    const known = itemQuartile(item);
    if (known) score += known === targetQuartile ? 0.75 : -0.75;
  }
  return score + dateScore(item, question, analysis);
}
function identity(item) {
  const type = resourceType(item);
  const id = first(item._key, item.u_key, item.sourceid, item.source_id);
  if (id) return `${type}|${normalize(id)}`;
  if (type === "journal") {
    const issn = first(item.issn, item.primary_issn);
    return `journal|${normalize(
      issn || first(item.title, item.name, item.journal_title)
    )}`;
  }
  const name = first(
    item.name, item.title, item.conference_name,
    item.event_name, item.acronym
  );
  const date = first(
    item.start_date, item.event_date, item.conference_date
  );
  return `conference|${normalize(name)}|${normalize(date)}`;
}
function dedupe(items) {
  const found = new Map();
  for (const item of items) {
    const key = identity(item);
    if (!key || key === "journal|" || key === "conference||") continue;
    const previous = found.get(key);
    if (!previous || item.score > previous.score) found.set(key, item);
  }
  return [...found.values()];
}
async function searchCollection(collection, vectors, topk) {
  const searches = vectors.map(async (vector, index) => {
    if (!vector) return [];
    try {
      const results = await qdrant.search(collection, {
        vector,
        limit: Math.min(Math.max(topk * 3, 40), MAX_LIMIT),
        with_payload: true
      });
      const weight = index === 0 ? 1 : 0.75;
      return results.map(result => ({
        ...(result.payload || {}),
        _qdrantCollection: collection,
        _qdrantId: result.id,
        baseScore: (Number(result.score) || 0) * weight
      }));
    } catch (error) {
      console.error(`❌ Qdrant search ${collection}:`, error?.message || error);
      return [];
    }
  });
  return (await Promise.all(searches)).flat();
}
function cacheGet(key) {
  const entry = QUERY_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time >= QUERY_TTL) {
    QUERY_CACHE.delete(key);
    return null;
  }
  return entry.value;
}
function cacheSet(key, value) {
  QUERY_CACHE.set(key, { value, time: Date.now() });
  if (QUERY_CACHE.size > 500) {
    QUERY_CACHE.delete(QUERY_CACHE.keys().next().value);
  }
}
export async function searchConferenceJournalByVector({
  question,
  topk = 10
}) {
  const rawQuestion = String(question ?? "").trim();
  const safeTopK = Math.max(
    1, Math.min(Math.trunc(Number(topk)) || 10, MAX_LIMIT)
  );
  const empty = domain => ({ domain, conferences: [], journals: [] });
  if (!rawQuestion) return empty(null);
  const cacheKey = `${normalize(rawQuestion)}|${safeTopK}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  try {
    const domain = detectDomain(rawQuestion);
    const analysis = analyzeQuestion(rawQuestion) || {};
    const targetQuartile = requestedQuartile(rawQuestion, analysis);
    const targetCountry = first(
      analysis.wantsCountryCode, analysis.countryCode,
      analysis.country, analysis.countryHint
    );
    const collections = domain === "conference"
      ? ["conference_vectors"]
      : domain === "journal"
        ? ["journal_vectors"]
        : ["conference_vectors", "journal_vectors"];
    const cleaned = cleanQuery(rawQuestion);
    const inputs = cleaned && cleaned !== rawQuestion
      ? [rawQuestion, cleaned]
      : [rawQuestion];
    const vectors = await embedBatch(inputs);
    if (!Array.isArray(vectors) || !vectors.length) return empty(domain);

    let results = (await Promise.all(
      collections.map(collection =>
        searchCollection(collection, vectors, safeTopK)
      )
    )).flat();

    results = results
      .filter(item =>
        domain === "conference"
          ? resourceType(item) === "conference"
          : domain === "journal"
            ? resourceType(item) === "journal"
            : true
      )
      .map(item => ({
        ...item,
        score: scoreItem(
          item, rawQuestion, analysis,
          targetQuartile, targetCountry
        )
      }));
    results = dedupe(results);

    if (targetCountry) {
      results = results.filter(item =>
        countryState(item, targetCountry) !== "mismatch"
      );
    }
    if (targetQuartile && domain !== "conference") {
      const journals = results.filter(item =>
        resourceType(item) === "journal"
      );
      const matching = journals.filter(item =>
        itemQuartile(item) === targetQuartile
      );
      if (matching.length) {
        results = results.filter(item =>
          resourceType(item) !== "journal"
        ).concat(matching);
      }
    }

    results.sort((a, b) => b.score - a.score);
    const output = {
      domain,
      conferences: domain === "journal"
        ? []
        : results.filter(item =>
            resourceType(item) === "conference"
          ).slice(0, safeTopK),
      journals: domain === "conference"
        ? []
        : results.filter(item =>
            resourceType(item) === "journal"
          ).slice(0, safeTopK)
    };
    cacheSet(cacheKey, output);
    return output;
  } catch (error) {
    console.error("❌ Scholar search fatal:", error);
    return empty(null);
  }
}