// scholar.agent.js
import { searchConferenceJournalByVector } from "./scholar.search.js";
import { detectDomain, analyzeQuestion } from "./agentReasoning.js";
import { rankItems, smartFilter } from "./scholar.ranking.js";

const MAX_CANDIDATES = 15;
const FINAL_TOPK = 5;

// ================= SAFE =================
function safe(x) {
  if (!x) return "";
  if (Array.isArray(x)) return x.join(", ");
  if (typeof x === "object") return JSON.stringify(x);
  return String(x);
}

// ================= CHECK VALUE =================
function hasValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

// ================= NORMALIZE =================
function normalizeText(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

// ================= COUNTRY =================
function normalizeCountry(c) {
  const map = {
    vn: "vietnam",
    usa: "united states",
    us: "united states",
    china: "china",
    "trung quoc": "china"
  };
  const n = normalizeText(c);
  return map[n] || n;
}

// ================= 🔥 SMART COUNTRY FILTER =================
function filterByCountry(items, analysis) {
  if (!analysis?.wantsCountryCode) return items;

  const target = normalizeCountry(analysis.wantsCountryCode);

  // ===== tier 1: strict match =====
  const strict = items.filter(it => {
    const c = normalizeCountry(it.country);
    return c.includes(target);
  });

  if (strict.length > 0) return strict;

  // ===== tier 2: semantic fallback =====
  const fallback = items.filter(it => {
    const text = normalizeText(it.text || "");
    return text.includes(target);
  });

  if (fallback.length > 0) return fallback;

  // ===== tier 3: return original (ranking sẽ xử lý) =====
  return items;
}

// ================= URL =================
function getConferenceUrl(c) {
  return (
    c.cfp_link ||
    c.url ||
    c.link ||
    c.website ||
    "" // ❌ no google fallback
  );
}

function getJournalUrl(j) {
  return j.scimago_link || j.url || "";
}

// ================= DEDUPE =================
function normalizeKey(it) {
  return normalizeText(
    it.title || it.name || it.acronym || ""
  ).replace(/\d{4}/g, "");
}

function dedupe(items) {
  const map = new Map();
  for (const it of items) {
    const key = normalizeKey(it);
    if (!key) continue;
    if (!map.has(key)) map.set(key, it);
  }
  return [...map.values()];
}

// ================= DATE =================
function safeTime(dateStr) {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  return isNaN(t) ? null : t;
}

// ================= BADGE =================
function getBadge(index) {
  if (index === 0) return "🥇 Top phù hợp nhất";
  if (index === 1) return "🔥 Nổi bật";
  if (index === 2) return "⭐ Đáng cân nhắc";
  return "";
}

// ================= FIELD MATCH =================
function fieldMatch(item, fieldHint) {
  const field = normalizeText(fieldHint);

  const text = normalizeText(
    [
      item.text,
      item.topics,
      item.categories,
      ...(item.fields || [])
    ].join(" ")
  );

  return text.includes(field);
}

// ================= EXPLAIN =================
function buildExplain(item, analysis) {
  const reasons = [];
  const now = Date.now();

  const deadline = safeTime(item.deadline);
  const start = safeTime(item.start_date);

  if (deadline) {
    const diff = (deadline - now) / (1000 * 60 * 60 * 24);

    if (diff > 0 && diff < 14) reasons.push("🔥 Sắp hết hạn");
    else if (diff > 0 && diff < 60) reasons.push("⏳ Còn hạn");
    else if (diff > 60) reasons.push("📢 Đang nhận bài");
    else if (diff < 0) reasons.push("❌ Đã hết hạn");
  }

  if (start) {
    const diff = (start - now) / (1000 * 60 * 60 * 24);
    if (diff > 0 && diff < 30) reasons.push("📅 Sắp diễn ra");
  }

  if (analysis?.fieldHint && fieldMatch(item, analysis.fieldHint)) {
    reasons.push("🎯 Đúng lĩnh vực");
  }

  if (item.sjr_best_quartile === "Q1") {
    reasons.push("🏆 Q1");
  }

  if (reasons.length <= 1) return "";

  return `💡 ${reasons.join(" • ")}`;
}

// ================= ANALYSIS =================
function buildAnalysis(question, conferences, journals) {
  const total = conferences.length + journals.length;

  if (!total) {
    return "Không tìm thấy kết quả chính xác, hiển thị kết quả gần nhất.";
  }

  return `Tìm thấy ${total} kết quả phù hợp với "${question}".`;
}

// ================= FORMAT =================
function formatFinalAnswer(answer, conferences, journals, analysis) {
  let content = answer || "";

  if (conferences.length) {
    content += `\n\n## 🎓 Hội thảo liên quan\n\n`;

    conferences.forEach((c, i) => {
      const url = getConferenceUrl(c);
      const explain = buildExplain(c, analysis);

      content += `### ${i + 1}. **${safe(c.name || c.title)}** ${getBadge(i)}\n`;

      const location = [c.city, c.country].filter(hasValue).join(", ");
      if (location) content += `- 📍 ${location}  \n`;

      if (hasValue(c.deadline)) {
        content += `- ⏳ ${safe(c.deadline)}  \n`;
      }

      if (hasValue(c.start_date)) {
        content += `- 📅 ${safe(c.start_date)}  \n`;
      }

      if (explain) {
        content += `- ${explain}  \n`;
      }

      if (url) {
        content += `- 🌐 ${url}\n\n`;
      }
    });
  }

  if (journals.length) {
    content += `\n## 📚 Tạp chí liên quan\n\n`;

    journals.forEach((j, i) => {
      const url = getJournalUrl(j);
      const explain = buildExplain(j, analysis);

      content += `### ${i + 1}. **${safe(j.title)}** ${getBadge(i)}\n`;

      if (hasValue(j.publisher)) {
        content += `- 🏢 ${safe(j.publisher)}  \n`;
      }

      if (hasValue(j.sjr_best_quartile)) {
        content += `- 🏆 ${safe(j.sjr_best_quartile)}  \n`;
      }

      if (hasValue(j.country)) {
        content += `- 🌍 ${safe(j.country)}  \n`;
      }

      if (explain) {
        content += `- ${explain}  \n`;
      }

      if (url) {
        content += `- 🌐 ${url}\n\n`;
      }
    });
  }

  return content;
}

// ================= MAIN =================
export async function runAgent(question, topk = FINAL_TOPK) {
  const start = Date.now();

  try {
    const domain = detectDomain(question);
    const analysis = analyzeQuestion(question);

    const res = await searchConferenceJournalByVector({
      question,
      topk: MAX_CANDIDATES,
    });

    let conferences = dedupe(res.conferences || []);
    let journals = dedupe(res.journals || []);

    // 🔥 FIX CORE
    conferences = filterByCountry(conferences, analysis);
    journals = filterByCountry(journals, analysis);

    conferences = smartFilter(rankItems(conferences, question, analysis)).slice(0, topk);
    journals = smartFilter(rankItems(journals, question, analysis)).slice(0, topk);

    const intro = buildAnalysis(question, conferences, journals);
    const finalAnswer = formatFinalAnswer(intro, conferences, journals, analysis);

    return {
      answer: finalAnswer,
      conferences,
      journals,
      domain,
      analysis,
      responseTimeMs: Date.now() - start
    };

  } catch (err) {
    console.error("❌ Agent error:", err);

    return {
      answer: "Hệ thống đang gặp lỗi.",
      conferences: [],
      journals: [],
      domain: "error",
      analysis: {},
      responseTimeMs: Date.now() - start
    };
  }
}