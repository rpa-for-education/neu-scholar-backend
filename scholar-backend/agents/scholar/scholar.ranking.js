// agents/scholar/scholar.ranking.js
import { countryMatches } from "./agentReasoning.js";

const WEIGHTS = {
  vector: 0.5,
  keyword: 0.25,
  intent: 0.15,
  recency: 0.07,
  quality: 0.03
};

function normalize(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(normalize).filter(Boolean).join(" ");
  if (typeof value === "object") return Object.values(value).map(normalize).filter(Boolean).join(" ");
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tokenize(value) {
  return [...new Set(normalize(value).split(" ").filter(word => word.length > 2))];
}
function isConference(item) {
  if (item._qdrantCollection === "conference_vectors") return true;
  if (item._qdrantCollection === "journal_vectors") return false;
  const type = normalize(item.type || item.resource_type);
  if (type === "conference") return true;
  if (type === "journal") return false;
  return Boolean(item.deadline || item.start_date || item.cfp_text);
}
function keywordScore(item, queryWords) {
  if (!queryWords.length) return 0;
  const searchable = normalize([
    item.name, item.title, item.conference_name, item.journal_title,
    item.acronym, item.topics, item.categories, item.areas,
    item.fields, item.cfp_text, item.description,
    item.city, item.country, item.country_name
  ]);
  if (!searchable) return 0;
  return queryWords.filter(word => searchable.includes(word)).length / queryWords.length;
}
function intentScore(item, analysis) {
  let score = 0;

  if (analysis?.location?.name === "NEU") {
    const organizer = normalize(item.organizer);
    if (organizer.includes("kinh te quoc dan") || organizer.includes("national economics university")) {
      score += 1;
    }
  }

  if (analysis?.wantsCountryCode) {
    const countries = [
      item.country, item.country_name, item.location_country,
      item.nation, item.country_code, item.iso_code
    ];
    if (countries.some(value => countryMatches(value, analysis.wantsCountryCode))) {
      score += 0.5;
    }
  }

  if (analysis?.fieldHint) {
    const searchable = normalize([
      item.topics, item.categories, item.areas,
      item.fields, item.cfp_text, item.description
    ]);
    if (searchable.includes(normalize(analysis.fieldHint))) score += 0.5;
  }

  return Math.min(score, 1);
}
function dateScore(item) {
  if (!isConference(item)) return 0;

  const deadline = item.deadline || item.submission_deadline ||
    item.paper_deadline || item.cfp_deadline;
  const start = item.start_date || item.event_date || item.conference_date;
  const now = Date.now();

  if (deadline) {
    const date = new Date(deadline).getTime();
    if (Number.isFinite(date)) {
      const days = (date - now) / 86400000;
      if (days < 0) return 0;
      if (days < 30) return 1;
      if (days < 90) return 0.7;
      return 0.4;
    }
  }

  if (start) {
    const date = new Date(start).getTime();
    if (Number.isFinite(date)) {
      const days = (date - now) / 86400000;
      if (days < 0) return 0;
      if (days < 30) return 0.4;
      return 0.2;
    }
  }

  return 0;
}
function qualityScore(item) {
  if (isConference(item)) return 0;
  const quartile = normalize(item.quartile || item.sjr_best_quartile).toUpperCase();
  if (quartile === "Q1") return 1;
  if (quartile === "Q2") return 0.7;
  if (quartile === "Q3") return 0.4;
  if (quartile === "Q4") return 0.2;
  return 0;
}
function computeScore(item, queryWords, analysis) {
  // scholar.search.js đặt độ tương đồng vector gốc trong baseScore.
  // item.score đã chứa điểm cộng từ bước search nên không dùng lại làm vector.
  const vector = Number(item.baseScore ?? item._score ?? 0) || 0;
  const keyword = keywordScore(item, queryWords);
  const intent = intentScore(item, analysis);
  const recency = dateScore(item);
  const quality = qualityScore(item);

  return vector * WEIGHTS.vector
    + keyword * WEIGHTS.keyword
    + intent * WEIGHTS.intent
    + recency * WEIGHTS.recency
    + quality * WEIGHTS.quality;
}
export function rankItems(items, query, analysis = {}) {
  if (!Array.isArray(items) || !items.length) return [];
  const queryWords = tokenize(query);
  return items
    .map(item => ({
      ...item,
      finalScore: computeScore(item, queryWords, analysis)
    }))
    .sort((a, b) => b.finalScore - a.finalScore);
}
export function smartFilter(items) {
  if (!Array.isArray(items) || !items.length) return [];
  const topScore = Number(items[0].finalScore) || 0;
  const threshold = Math.max(topScore * 0.4, 0.15);
  const filtered = items.filter(item => Number(item.finalScore) >= threshold);
  return filtered.length ? filtered : items.slice(0, 5);
}