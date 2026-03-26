// agentReasoning.js
// =========================================
// 🔥 FINAL: ChatGPT-style Reasoning Engine
// Không filter chết, dùng scoring thông minh
// =========================================

import { COUNTRY_NAME_TO_ISO } from "../../services/scripts/country_iso_full.js";
import { COUNTRY_VI_TO_ISO } from "../../services/scripts/country_vi_alias.js";

// ================= NORMALIZE =================
function normalizeText(str) {
  return str
    .toLowerCase()
    .normalize("NFD") // 🔥 giữ tiếng Việt
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

  // 🇻🇳 tiếng Việt
  for (const [name, iso] of Object.entries(COUNTRY_VI_TO_ISO)) {
    const n = ` ${normalizeText(name)} `;
    if (words.includes(n)) return iso;
  }

  // 🌍 tiếng Anh
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
  const q = question.toLowerCase();

  const fields = [
    { key: "economics", match: ["kinh tế học", "economics"] },
    { key: "business administration", match: ["quản trị kinh doanh", "qtkd"] },
    { key: "finance", match: ["tài chính"] },
    { key: "marketing", match: ["marketing"] },
    { key: "data analytics", match: ["phân tích dữ liệu"] },
    { key: "econometrics", match: ["kinh tế lượng"] },
    { key: "logistics", match: ["chuỗi cung ứng"] },
    {
      key: "information systems",
      match: ["mis", "hệ thống thông tin", "information system"]
    }
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

    wantsCountryCode: countryCode,
    location,
    fieldHint: extractResearchField(question)
  };
}

// ================= 🔥 REASONING CORE =================
export function applyFilters(items, analysis, domain) {
  if (!items || !items.length) return [];

  const now = new Date();

  return items
    .map(item => {
      let score = item._score || item.score || 0.3;

      // ===== COUNTRY =====
      if (analysis.wantsCountryCode) {
        if (
          (item.country_code || "").toUpperCase() ===
          analysis.wantsCountryCode
        ) {
          score += 0.4;
        } else {
          score -= 0.2;
        }
      }

      // ===== CITY / NEU =====
      if (analysis.location?.city) {
        const city = (item.city || "").toLowerCase();

        if (city.includes(analysis.location.city)) {
          score += 0.5;
        }
      }

      // ===== YEAR =====
      if (domain === "conference" && analysis.wantsRecent) {
        const year = String(analysis.wantsRecent[0]);

        if (item.start_date?.startsWith(year)) {
          score += 0.4;
        } else {
          score -= 0.1;
        }
      }

      // ===== DEADLINE =====
      if (analysis.wantsDeadline && item.deadline) {
        const d = new Date(item.deadline);
        const diff = (d - now) / (1000 * 60 * 60 * 24);

        if (diff > 0 && diff < 60) {
          score += 0.3;
        }
      }

      // ===== FIELD =====
      if (analysis.fieldHint) {
        const text = (
          item.text ||
          item.topics ||
          item.categories ||
          ""
        ).toLowerCase();

        if (text.includes(analysis.fieldHint)) {
          score += 0.4;
        }
      }

      // ===== QUALITY =====
      if (item.sjr_best_quartile === "Q1") score += 0.3;
      if (item.sjr_best_quartile === "Q2") score += 0.2;

      // ===== INTENT =====
      if (analysis.wantsRanking && item.h_index > 50) {
        score += 0.3;
      }

      // ===== ANTI NEGATIVE =====
      if (score < 0) score = 0;

      return {
        ...item,
        reasoningScore: score
      };
    })
    .sort((a, b) => b.reasoningScore - a.reasoningScore);
}

// ================= FINAL =================
export function finalizeResults(items, limit = 10) {
  return items.slice(0, limit);
}