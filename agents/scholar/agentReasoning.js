// agentReasoning.js

import { COUNTRY_NAME_TO_ISO } from "../../services/scripts/country_iso_full.js";
import { COUNTRY_VI_TO_ISO } from "../../services/scripts/country_vi_alias.js";

// ================= NORMALIZE =================
function normalizeText(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ================= COUNTRY NORMALIZE =================
function normalizeCountry(c) {
  const map = {
    vn: "vietnam",
    usa: "united states",
    us: "united states"
  };

  return map[normalizeText(c)] || normalizeText(c);
}

// ================= LOCATION =================
function detectSpecialLocation(question) {
  const q = normalizeText(question);

  if (q.includes("neu") || q.includes("kinh te quoc dan")) {
    return {
      type: "point",
      name: "NEU",
      city: "hanoi",
      country: "vietnam",
      countryCode: "VN"
    };
  }

  return null;
}

// ================= COUNTRY =================
export function extractCountryIntent(question) {
  if (!question) return null;

  const q = normalizeText(question);
  const words = ` ${q} `;

  for (const [name, iso] of Object.entries(COUNTRY_VI_TO_ISO)) {
    const n = ` ${normalizeText(name)} `;
    if (words.includes(n)) return iso;
  }

  const entries = Object.entries(COUNTRY_NAME_TO_ISO)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [name, iso] of entries) {
    const n = ` ${normalizeText(name)} `;
    if (words.includes(n)) return iso;
  }

  return null;
}

// ================= DOMAIN =================
export function detectDomain(question) {
  const q = question.toLowerCase();

  if (
    (q.includes("journal") || q.includes("tạp chí")) &&
    (q.includes("conference") || q.includes("hội thảo"))
  ) return "both";

  if (
    q.includes("conference") ||
    q.includes("hội thảo") ||
    q.includes("cfp") ||
    q.includes("submission")
  ) return "conference";

  if (q.includes("journal") || q.includes("tạp chí"))
    return "journal";

  return "general";
}

// ================= FIELD =================
export function extractResearchField(question) {
  const q = normalizeText(question);

  const fields = [
    { key: "economics", match: ["kinh te", "economics"] },
    { key: "finance", match: ["tai chinh", "finance"] },
    { key: "marketing", match: ["marketing"] },
    { key: "business", match: ["quan tri", "business"] },

    { key: "artificial intelligence", match: ["ai", "tri tue nhan tao"] },
    { key: "data science", match: ["data science", "khoa hoc du lieu"] },
    { key: "machine learning", match: ["machine learning", "hoc may"] },
    { key: "blockchain", match: ["blockchain"] },
    { key: "information systems", match: ["mis", "he thong thong tin"] },
    { key: "computer science", match: ["cntt", "computer science"] }
  ];

  for (const f of fields) {
    if (f.match.some(m => q.includes(m))) {
      return f.key;
    }
  }

  return null;
}

// ================= ANALYZE =================
export function analyzeQuestion(question) {
  const q = question.toLowerCase();

  const location = detectSpecialLocation(question);
  const countryCode =
    location?.countryCode || extractCountryIntent(question);

  return {
    wantsRanking:
      q.includes("uy tín") ||
      q.includes("top") ||
      q.includes("ranking"),

    wantsQuartile:
      q.includes("q1") ||
      q.includes("q2"),

    wantsRecent:
      q.match(/20(2[5-9]|3[0-9])/),

    wantsDeadline:
      q.includes("deadline") ||
      q.includes("hạn nộp"),

    wantsRecommendation:
      q.includes("nên") ||
      q.includes("phù hợp"),

    wantsCountryCode: countryCode,
    location,
    fieldHint: extractResearchField(question)
  };
}

// ================= 🔥 FIELD MATCH (UPGRADE) =================
function fieldMatch(item, fieldHint) {
  const field = normalizeText(fieldHint);

  const text = normalizeText(
    item.text ||
    item.topics ||
    item.categories ||
    ""
  );

  const fields = (item.fields || []).map(normalizeText);

  let score = 0;

  // exact
  if (text.includes(field)) score += 0.25;

  // partial match
  for (const f of fields) {
    if (f.includes(field) || field.includes(f)) {
      score += 0.25;
    }
  }

  // token overlap (AI, data, etc.)
  const tokens = field.split(" ");
  for (const t of tokens) {
    if (text.includes(t)) score += 0.1;
  }

  return score;
}

// ================= BOOST ENGINE =================
export function applyFilters(items, analysis, domain) {
  if (!items || !items.length) return [];

  const now = Date.now();

  return items.map(item => {
    let boost = 0;

    // ===== COUNTRY =====
    if (analysis.wantsCountryCode) {
      const itemCountry = normalizeCountry(item.country);
      const target = normalizeCountry(analysis.wantsCountryCode);

      if (itemCountry.includes(target)) boost += 0.2;
    }

    // ===== DEADLINE =====
    if (item.deadline) {
      const d = new Date(item.deadline).getTime();
      const diff = (d - now) / (1000 * 60 * 60 * 24);

      if (diff > 0) {
        boost += 0.3;

        if (diff < 30) boost += 0.3;
      } else {
        boost -= 0.2;
      }
    }

    // ===== FIELD (🔥 FIX CHÍNH) =====
    if (analysis.fieldHint) {
      boost += fieldMatch(item, analysis.fieldHint);
    }

    // ===== QUALITY =====
    if (item.sjr_best_quartile === "Q1") boost += 0.2;

    return {
      ...item,
      reasoningBoost: boost
    };
  });
}

// ================= FINAL =================
export function finalizeResults(items, limit = 10) {
  return items.slice(0, limit);
}