// agents/scholar/agentReasoning.js
import { COUNTRY_NAME_TO_ISO } from "../../services/scripts/country_iso_full.js";
import { COUNTRY_VI_TO_ISO } from "../../services/scripts/country_vi_alias.js";

// ================= NORMALIZE =================
function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function containsPhrase(text, phrase) {
  const target = normalizeText(phrase);
  return Boolean(target) && ` ${normalizeText(text)} `.includes(` ${target} `);
}
function containsAny(text, phrases) {
  return phrases.some(phrase => containsPhrase(text, phrase));
}
function asText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(" ");
  if (typeof value === "object") return Object.values(value).map(asText).filter(Boolean).join(" ");
  return String(value);
}

// ================= COUNTRY =================
const COUNTRY_ENTRIES = [
  ...Object.entries(COUNTRY_VI_TO_ISO || {}),
  ...Object.entries(COUNTRY_NAME_TO_ISO || {})
]
  .filter(([name, iso]) => normalizeText(name) && String(iso ?? "").trim())
  .sort((a, b) => normalizeText(b[0]).length - normalizeText(a[0]).length);

const COUNTRY_LOOKUP = new Map();

for (const [name, iso] of COUNTRY_ENTRIES) {
  const code = String(iso).trim().toUpperCase();
  COUNTRY_LOOKUP.set(normalizeText(name), code);
  COUNTRY_LOOKUP.set(normalizeText(code), code);
}

// Bổ sung cách gọi thường gặp; danh sách quốc gia chính vẫn nằm trong hai file import.
for (const [name, code] of Object.entries({
  vn: "VN",
  vietnam: "VN",
  "viet nam": "VN",
  us: "US",
  usa: "US",
  america: "US",
  "united states": "US",
  "united states of america": "US",
  uk: "GB",
  britain: "GB",
  england: "GB",
  "united kingdom": "GB"
})) {
  COUNTRY_LOOKUP.set(normalizeText(name), code);
}

export function normalizeCountryCode(value) {
  const name = normalizeText(value);
  if (!name) return null;
  return COUNTRY_LOOKUP.get(name) || null;
}
export function countryMatches(itemCountry, requestedCountry) {
  const targetCode = normalizeCountryCode(requestedCountry);
  const itemCode = normalizeCountryCode(itemCountry);
  if (targetCode && itemCode) return targetCode === itemCode;

  // Chỉ so khớp văn bản khi một trong hai cách viết không có trong bảng ISO.
  const targetText = normalizeText(requestedCountry);
  const itemText = normalizeText(itemCountry);
  return Boolean(targetText && itemText && targetText === itemText);
}
function detectSpecialLocation(question) {
  if (!containsAny(question, ["NEU", "kinh tế quốc dân"])) return null;
  return {
    type: "point",
    name: "NEU",
    city: "hanoi",
    country: "vietnam",
    countryCode: "VN"
  };
}
export function extractCountryIntent(question) {
  if (!question) return null;

  // Ưu tiên tên quốc gia dài để tránh tên ngắn khớp trước tên đầy đủ.
  for (const [name, iso] of COUNTRY_ENTRIES) {
    if (containsPhrase(question, name)) return String(iso).trim().toUpperCase();
  }

  // Chỉ nhận mã ISO hai chữ cái khi người dùng viết hoa mã đó.
  // Tránh coi từ thông thường hai chữ cái là mã quốc gia.
  const isoWords = String(question).match(/\b[A-Z]{2}\b/g) || [];
  for (const word of isoWords) {
    const code = normalizeCountryCode(word);
    if (code) return code;
  }

  return null;
}

// ================= DOMAIN =================
export function detectDomain(question) {
  const conference = containsAny(question, [
    "conference", "conferences", "hội thảo", "hội nghị khoa học",
    "cfp", "call for papers", "hạn nộp bài", "deadline nộp bài"
  ]);
  const journal = containsAny(question, [
    "journal", "journals", "tạp chí", "scimago", "sjr",
    "quartile", "issn", "q1", "q2", "q3", "q4"
  ]);

  if (conference && journal) return "both";
  if (conference) return "conference";
  if (journal) return "journal";
  return "general";
}

// ================= FIELD =================
export function extractResearchField(question) {
  const fields = [
    { key: "economics", match: ["kinh tế", "economics"] },
    { key: "finance", match: ["tài chính", "finance"] },
    { key: "marketing", match: ["marketing"] },
    { key: "business", match: ["quản trị", "business"] },
    { key: "artificial intelligence", match: ["ai", "trí tuệ nhân tạo", "artificial intelligence"] },
    { key: "data science", match: ["data science", "khoa học dữ liệu"] },
    { key: "machine learning", match: ["machine learning", "học máy"] },
    { key: "blockchain", match: ["blockchain"] },
    { key: "information systems", match: ["mis", "hệ thống thông tin"] },
    { key: "computer science", match: ["cntt", "công nghệ thông tin", "computer science"] }
  ];

  for (const field of fields) {
    if (containsAny(question, field.match)) return field.key;
  }
  return null;
}

// ================= ANALYZE =================
export function analyzeQuestion(question) {
  const q = normalizeText(question);
  const location = detectSpecialLocation(question);
  const countryCode = location?.countryCode || extractCountryIntent(question);
  const quartileMatch = q.match(/\bq\s*([1-4])\b/);
  const yearMatch = q.match(/\b20(?:2[5-9]|3[0-9])\b/);

  return {
    wantsRanking: containsAny(q, ["uy tín", "top", "ranking", "xếp hạng"]),
    wantsQuartile: Boolean(quartileMatch),
    quartile: quartileMatch ? `Q${quartileMatch[1]}` : null,
    wantsRecent: Boolean(yearMatch),
    year: yearMatch ? Number(yearMatch[0]) : null,
    wantsDeadline: containsAny(q, ["deadline", "hạn nộp", "submission deadline"]),
    wantsRecommendation: containsAny(q, ["nên", "phù hợp", "gợi ý"]),
    wantsOpen: containsAny(q, ["còn hạn", "còn nhận bài", "đang nhận bài"]),
    wantsUpcoming: containsAny(q, ["sắp tới", "sắp diễn ra", "upcoming"]),
    wantsCountryCode: countryCode,
    location,
    fieldHint: extractResearchField(question)
  };
}

// ================= FIELD MATCH =================
function fieldMatch(item, fieldHint) {
  const field = normalizeText(fieldHint);
  if (!field) return 0;

  const searchable = normalizeText(asText([
    item.text,
    item.description,
    item.cfp_text,
    item.topics,
    item.categories,
    item.areas,
    item.fields
  ]));
  if (!searchable) return 0;

  let score = searchable.includes(field) ? 0.25 : 0;
  const tokens = field.split(" ").filter(token => token.length > 1);
  if (tokens.length) {
    const matches = tokens.filter(token => containsPhrase(searchable, token)).length;
    score += (matches / tokens.length) * 0.25;
  }
  return score;
}

// ================= BOOST ENGINE =================
export function applyFilters(items, analysis = {}, domain = "general") {
  if (!Array.isArray(items) || !items.length) return [];
  const now = Date.now();

  return items.map(item => {
    let boost = 0;

    if (analysis.wantsCountryCode) {
      const countries = [
        item.country,
        item.country_name,
        item.location_country,
        item.nation,
        item.country_code,
        item.iso_code
      ];
      if (countries.some(value => countryMatches(value, analysis.wantsCountryCode))) {
        boost += 0.2;
      }
    }

    const deadline = item.deadline || item.submission_deadline || item.paper_deadline;
    if (deadline && domain !== "journal") {
      const date = new Date(deadline).getTime();
      if (Number.isFinite(date)) {
        const days = (date - now) / 86400000;
        if (days > 0) boost += days < 30 ? 0.6 : 0.3;
        else if (analysis.wantsDeadline || analysis.wantsOpen) boost -= 0.2;
      }
    }

    if (analysis.fieldHint) boost += fieldMatch(item, analysis.fieldHint);
    if (item.sjr_best_quartile === "Q1") boost += 0.2;

    return { ...item, reasoningBoost: boost };
  });
}

// ================= FINAL =================
export function finalizeResults(items, limit = 10) {
  if (!Array.isArray(items)) return [];
  const safeLimit = Math.max(1, Math.trunc(Number(limit)) || 10);
  return items.slice(0, safeLimit);
}