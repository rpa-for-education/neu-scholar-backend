// agentReasoning.js
// =========================================
// Academic Agent Reasoning (NEU FIXED)
// =========================================

const CONTINENT_MAP = [
  { key: "Asia", match: ["châu á", "asia", "asian"] },
  { key: "Europe", match: ["châu âu", "europe", "eu"] },
  { key: "North America", match: ["bắc mỹ", "north america", "usa", "canada"] },
  { key: "South America", match: ["nam mỹ", "south america"] },
  { key: "Oceania", match: ["châu đại dương", "oceania", "australia"] },
  { key: "Africa", match: ["châu phi", "africa"] }
];

import { COUNTRY_NAME_TO_ISO } from "../../services/scripts/country_iso_full.js";
import { COUNTRY_VI_TO_ISO } from "../../services/scripts/country_vi_alias.js";

// ================= NORMALIZE =================
function normalizeText(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ================= 🔥 LOCATION GROUNDING =================
function detectSpecialLocation(question) {
  const q = normalizeText(question);

  // 👉 NEU fix cứng
  if (q.includes("neu") || q.includes("kinh te quoc dan")) {
    return {
      type: "point",
      name: "NEU",
      city: "Hanoi",
      country: "Vietnam",
      countryCode: "VN"
    };
  }

  return null;
}

// ================= COUNTRY DETECTION =================
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

  if (q.includes("conference") || q.includes("hội thảo") || q.includes("cfp"))
    return "conference";

  if (q.includes("journal") || q.includes("tạp chí"))
    return "journal";

  if (
    q.includes("so sánh") ||
    q.includes("compare") ||
    (q.includes("journal") && q.includes("conference"))
  )
    return "both";

  return "general";
}

// ================= ANALYZE =================
export function analyzeQuestion(question) {
  const q = question.toLowerCase();

  // 🔥 detect special location FIRST
  const specialLocation = detectSpecialLocation(question);

  let wantsContinent = null;

  // 👉 nếu đã detect NEU thì bỏ continent
  if (!specialLocation) {
    for (const c of CONTINENT_MAP) {
      if (c.match.some(m => q.includes(m))) {
        wantsContinent = c.key;
        break;
      }
    }
  }

  const countryCode =
    specialLocation?.countryCode || extractCountryIntent(question);

  return {
    wantsRanking:
      q.includes("uy tín") ||
      q.includes("top") ||
      q.includes("ranking") ||
      q.includes("impact"),

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
      q.includes("phù hợp") ||
      q.includes("recommend"),

    wantsSurvey:
      q.includes("tổng quan") ||
      q.includes("overview") ||
      q.includes("review"),

    wantsCompare:
      q.includes("so sánh") ||
      q.includes("compare"),

    // 🔥 FIX
    wantsContinent,
    wantsCountryCode: countryCode,

    // 🔥 NEW
    location: specialLocation,

    fieldHint: extractResearchField(question)
  };
}

// ================= FIELD =================
export function extractResearchField(question) {
  const q = question.toLowerCase();

  const fields = [
    { key: "economics", match: ["kinh tế học", "economics"] },
    { key: "business administration", match: ["quản trị kinh doanh", "qtkd"] },
    { key: "finance", match: ["tài chính"] },
    { key: "marketing", match: ["marketing"] },
    { key: "data analytics", match: ["phân tích dữ liệu"] },
    { key: "econometrics", match: ["kinh tế lượng"] },
    { key: "logistics", match: ["chuỗi cung ứng"] },
    { key: "information systems", match: ["mis"] }
  ];

  for (const f of fields) {
    if (f.match.some(m => q.includes(m))) {
      return f.key;
    }
  }

  return null;
}

// ================= SEMANTIC =================
export function buildSemanticQuery(analysis, domain) {
  // 🔥 ưu tiên location
  if (analysis.location) {
    return `academic conference in ${analysis.location.city} Vietnam`;
  }

  if (analysis.fieldHint) return analysis.fieldHint;

  if (domain === "conference")
    return "international academic conference in economics";

  if (domain === "journal")
    return "academic journal in economics";

  return "scientific research";
}

// ================= FILTER =================
export function applyFilters(items, analysis, domain) {
  let results = [...items];

  // 🔥 FILTER BY COUNTRY (IMPORTANT)
  if (analysis.wantsCountryCode) {
    results = results.filter(r =>
      (r.metadata?.country_code || "").toUpperCase() ===
      analysis.wantsCountryCode
    );
  }

  // 🔥 FILTER BY CITY (NEU case)
  if (analysis.location?.city) {
    results = results.filter(r =>
      (r.metadata?.city || "").toLowerCase().includes(
        analysis.location.city.toLowerCase()
      )
    );
  }

  // existing filters
  if (domain === "conference" && analysis.wantsRecent) {
    const year = String(analysis.wantsRecent[0]);
    results = results.filter(c =>
      c.start_date && c.start_date.startsWith(year)
    );
  }

  return results;
}

// ================= RANK =================
export function rankResults(items, domain, analysis) {
  const results = [...items];

  if (domain === "conference") {
    results.sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;

      // 🔥 boost Vietnam / Hanoi
      if (analysis.location) {
        if (a.metadata?.country === "Vietnam") scoreA += 50;
        if (b.metadata?.country === "Vietnam") scoreB += 50;

        if (a.metadata?.city === "Hanoi") scoreA += 100;
        if (b.metadata?.city === "Hanoi") scoreB += 100;
      }

      return scoreB - scoreA;
    });
  }

  return results;
}

// ================= FINAL =================
export function finalizeResults(items, limit = 10) {
  return items.slice(0, limit);
}