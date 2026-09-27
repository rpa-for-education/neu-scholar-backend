// agents/fund/agentReasoning.js
import { COUNTRY_NAME_TO_ISO } from "../../services/scripts/country_iso_full.js";
import { COUNTRY_VI_TO_ISO } from "../../services/scripts/country_vi_alias.js";

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function hasPhrase(value, phrase) {
  const word = normalize(phrase);
  return Boolean(word) &&
    ` ${normalize(value)} `.includes(` ${word} `);
}
function hasAny(value, phrases) {
  return phrases.some(phrase => hasPhrase(value, phrase));
}

const COUNTRY_ENTRIES = [
  ...Object.entries(COUNTRY_VI_TO_ISO || {}),
  ...Object.entries(COUNTRY_NAME_TO_ISO || {})
]
  .filter(([name, iso]) =>
    normalize(name) && String(iso ?? "").trim()
  )
  .sort((a, b) =>
    normalize(b[0]).length - normalize(a[0]).length
  );

function detectCountry(query) {
  if (hasAny(query, [
    "việt nam", "viet nam", "vietnam", "vn"
  ])) return "vietnam";

  if (hasAny(query, [
    "mỹ", "hoa kỳ", "hoa ky", "usa",
    "united states", "united states of america"
  ])) return "usa";

  for (const [name, iso] of COUNTRY_ENTRIES) {
    if (hasPhrase(query, name)) {
      const code = String(iso).trim().toUpperCase();
      if (code === "VN") return "vietnam";
      if (code === "US") return "usa";
      return code;
    }
  }

  // Chỉ nhận mã ISO khi người dùng viết hoa mã hai chữ cái.
  const codes = String(query ?? "").match(/\b[A-Z]{2}\b/g) || [];
  const known = new Set(
    COUNTRY_ENTRIES.map(([, iso]) =>
      String(iso).trim().toUpperCase()
    )
  );

  for (const code of codes) {
    if (!known.has(code)) continue;
    if (code === "VN") return "vietnam";
    if (code === "US") return "usa";
    return code;
  }
  return null;
}

export function detectIntent(query = "") {
  const q = normalize(query);
  const keywords = [];

  if (hasAny(q, [
    "ai", "trí tuệ nhân tạo", "artificial intelligence"
  ])) keywords.push("ai");

  if (hasAny(q, [
    "y tế", "sức khỏe", "health", "medical"
  ])) keywords.push("health");

  if (hasAny(q, [
    "giáo dục", "education"
  ])) keywords.push("education");

  if (hasAny(q, [
    "cơ bản", "basic research"
  ])) keywords.push("basic research");

  if (hasPhrase(q, "nafosted")) keywords.push("nafosted");
  if (hasPhrase(q, "nsf")) keywords.push("nsf");

  const country = detectCountry(query);

  if (
    country === "vietnam" &&
    keywords.includes("basic research") &&
    !keywords.includes("nafosted")
  ) {
    keywords.push("nafosted");
  }

  const yearMatch = q.match(/\b20\d{2}\b/);

  return {
    country,
    year: yearMatch ? Number(yearMatch[0]) : null,
    keywords
  };
}

export function rewriteQuery(query, intent = {}) {
  const original = String(query ?? "").trim();
  if (!original) return "";

  const additions = [];

  if (
    intent.country === "vietnam" &&
    !hasAny(original, [
      "việt nam", "viet nam", "vietnam"
    ])
  ) {
    additions.push("vietnam");
  } else if (
    intent.country === "usa" &&
    !hasAny(original, [
      "usa", "united states", "mỹ", "hoa kỳ"
    ])
  ) {
    additions.push("united states");
  } else if (
    typeof intent.country === "string" &&
    /^[A-Z]{2}$/.test(intent.country)
  ) {
    additions.push(intent.country);
  }

  for (const keyword of Array.isArray(intent.keywords)
    ? intent.keywords
    : []) {
    if (keyword && !hasPhrase(original, keyword)) {
      additions.push(keyword);
    }
  }

  return [original, ...new Set(additions)].join(" ");
}