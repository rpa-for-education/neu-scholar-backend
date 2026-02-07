// agentReasoning.js
// =========================================
// Academic Agent Reasoning (NEU multi-field)
// =========================================



const CONTINENT_MAP = [
  { key: "Asia", match: ["châu á", "asia", "asian"] },
  { key: "Europe", match: ["châu âu", "europe", "eu"] },
  { key: "North America", match: ["bắc mỹ", "north america", "usa", "canada"] },
  { key: "South America", match: ["nam mỹ", "south america"] },
  { key: "Oceania", match: ["châu đại dương", "oceania", "australia"] },
  { key: "Africa", match: ["châu phi", "africa"] }
];

import { COUNTRY_NAME_TO_ISO } from "./scripts/country_iso_full.js";
import { COUNTRY_VI_TO_ISO } from "./scripts/country_vi_alias.js";

export function extractCountryIntent(question) {
  if (!question) return null;

  const q = question
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[.,()]/g, " ")
    .replace(/\s+/g, " ");

  // 1️⃣ Vietnamese aliases FIRST (ưu tiên)
  for (const [name, iso] of Object.entries(COUNTRY_VI_TO_ISO)) {
    if (q.includes(` ${name} `) || q.startsWith(name + " ") || q.endsWith(" " + name)) {
      return iso;
    }
  }

  // 2️⃣ English / international aliases
  const entries = Object.entries(COUNTRY_NAME_TO_ISO)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [name, iso] of entries) {
    if (q.includes(` ${name} `) || q.startsWith(name + " ") || q.endsWith(" " + name)) {
      return iso;
    }
  }

  return null;
}



/**
 * DOMAIN DETECTION
 */
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

/**
 * ANALYZE INTENT
 */
export function analyzeQuestion(question) {
  const q = question.toLowerCase();

  let wantsContinent = null;
  for (const c of CONTINENT_MAP) {
    if (c.match.some(m => q.includes(m))) {
      wantsContinent = c.key;
      break;
    }
  }

  const countryCode = extractCountryIntent(question);


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

    // 🔥 NEW
    wantsContinent,
    
    wantsCountryCode: countryCode,

    fieldHint: extractResearchField(question)
  };
}

/**
 * MULTI-DISCIPLINE FIELD EXTRACTION (NEU)
 */
export function extractResearchField(question) {
  const q = question.toLowerCase();

  const fields = [
    // ===== ECONOMICS =====
    { key: "economics", match: ["kinh tế học", "economics"] },
    { key: "development economics", match: ["phát triển", "development"] },
    { key: "macroeconomics", match: ["vĩ mô", "macroeconomics"] },
    { key: "microeconomics", match: ["vi mô", "microeconomics"] },

    // ===== BUSINESS & MANAGEMENT =====
    { key: "business administration", match: ["quản trị kinh doanh", "qtkd", "business administration"] },
    { key: "strategic management", match: ["chiến lược", "strategy"] },
    { key: "human resource management", match: ["nhân sự", "hrm", "nhân lực"] },
    { key: "marketing", match: ["marketing"] },
    { key: "consumer behavior", match: ["hành vi người tiêu dùng"] },

    // ===== FINANCE =====
    { key: "finance", match: ["tài chính", "finance"] },
    { key: "banking", match: ["ngân hàng", "banking"] },
    { key: "accounting", match: ["kế toán", "accounting"] },
    { key: "auditing", match: ["kiểm toán", "auditing"] },

    // ===== INFORMATION SYSTEMS =====
    { key: "management information systems", match: ["mis", "hệ thống thông tin quản lý"] },
    { key: "information systems", match: ["information systems"] },

    // ===== DATA & ANALYTICS =====
    { key: "business analytics", match: ["business analytics", "phân tích kinh doanh"] },
    { key: "data analytics", match: ["data analytics", "phân tích dữ liệu"] },
    { key: "econometrics", match: ["kinh tế lượng", "econometrics"] },
    { key: "statistics", match: ["thống kê", "statistics"] },

    // ===== LOGISTICS =====
    { key: "logistics and supply chain management", match: ["logistics", "chuỗi cung ứng"] },

    // ===== LAW & POLICY =====
    { key: "economic law", match: ["luật kinh tế"] },
    { key: "public policy", match: ["chính sách công"] },

    // ===== PUBLIC ADMIN =====
    { key: "public administration", match: ["quản lý công"] },

    // ===== INTERNATIONAL =====
    { key: "international business", match: ["kinh doanh quốc tế"] },
    { key: "international economics", match: ["kinh tế quốc tế"] },

    // ===== TOURISM =====
    { key: "tourism management", match: ["du lịch"] },

    // ===== SUSTAINABILITY =====
    { key: "sustainable development", match: ["phát triển bền vững", "sustainability"] },

    // ===== SOCIAL SCIENCES =====
    { key: "social sciences", match: ["xã hội học", "social science"] },

    // ===== DEFAULT =====
    { key: "business and economics", match: ["cntt", "it", "công nghệ"] }
  ];

  for (const f of fields) {
    if (f.match.some(m => q.includes(m))) {
      return f.key;
    }
  }

  return null;
}

/**
 * BUILD SEMANTIC QUERY FOR VECTOR SEARCH
 */
export function buildSemanticQuery(analysis, domain) {
  if (analysis.fieldHint) {
    return analysis.fieldHint;
  }

  if (domain === "journal") {
    return "academic journal in economics and business";
  }

  if (domain === "conference") {
    return "international academic conference in economics and management";
  }

  return "scientific research in economics and management";
}

/**
 * FILTER BY METADATA
 */
export function applyFilters(items, analysis, domain) {
  let results = [...items];

  if (domain === "journal" && analysis.wantsQuartile) {
    results = results.filter(j =>
      ["Q1", "Q2"].includes(j.sjr_best_quartile)
    );
  }

  if (domain === "conference" && analysis.wantsRecent) {
    const year = String(analysis.wantsRecent[0]);
    results = results.filter(c =>
      c.start_date && c.start_date.startsWith(year)
    );
  }

  return results;
}

/**
 * RANKING STRATEGY
 */
export function rankResults(items, domain) {
  const results = [...items];

  if (domain === "journal") {
    results.sort((a, b) => {
      const hA = Number(a.h_index || 0);
      const hB = Number(b.h_index || 0);
      return hB - hA;
    });
  }

  if (domain === "conference") {
    results.sort((a, b) => {
      const dA = new Date(a.deadline || "2100-01-01");
      const dB = new Date(b.deadline || "2100-01-01");
      return dA - dB;
    });
  }

  return results;
}

/**
 * FINAL OUTPUT
 */
export function finalizeResults(items, limit = 10) {
  return items.slice(0, limit);
}
