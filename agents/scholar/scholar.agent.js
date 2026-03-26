import { searchConferenceJournalByVector } from "./scholar.search.js";
import { detectDomain, analyzeQuestion } from "./agentReasoning.js";

const MAX_CANDIDATES = 15;
const FINAL_TOPK = 5;

// ================= SAFE =================
function safe(x) {
  if (!x) return "";
  if (Array.isArray(x)) return x.join(", ");
  if (typeof x === "object") return JSON.stringify(x);
  return String(x);
}

// ================= URL =================
function getConferenceUrl(c) {
  let url =
    c.url ||
    c.link ||
    c.website ||
    c.cfp_link ||
    "";

  if (!url && (c.title || c.name)) {
    const q = encodeURIComponent(
      `${c.title || c.name} ${c.acronym || ""} conference ${c.city || ""}`
    );
    url = `https://www.google.com/search?q=${q}`;
  }

  return url;
}

function getJournalUrl(j) {
  return j.scimago_link || j.url || "";
}

// ================= NORMALIZE =================
function normalizeKey(it) {
  return (
    it.title ||
    it.name ||
    it.acronym ||
    ""
  )
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\d{4}/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

// ================= DEDUPE =================
function dedupe(items) {
  const map = new Map();

  for (const it of items) {
    const key = normalizeKey(it);
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, it);
    }
  }

  return [...map.values()];
}

// ================= SORT =================
function sortByScore(items) {
  return items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

// ================= SMART SELECT =================
function smartSelect(items, topk) {
  const result = [];
  const used = new Set();

  for (const it of items) {
    const key = normalizeKey(it);

    if (used.has(key)) continue;

    result.push(it);
    used.add(key);

    if (result.length >= topk) break;
  }

  return result;
}

// ================= 🔥 EXPLAIN =================
function buildExplain(item, analysis) {
  const reasons = [];

  // 🎯 country match
  if (analysis?.wantsCountryCode && item.country_code === analysis.wantsCountryCode) {
    reasons.push("phù hợp khu vực yêu cầu");
  }

  // 🎯 field match
  if (analysis?.fieldHint) {
    const text = [
      item.topics,
      item.categories,
      item.areas,
      item.cfp_text
    ].join(" ").toLowerCase();

    if (text.includes(analysis.fieldHint.toLowerCase())) {
      reasons.push("liên quan trực tiếp lĩnh vực");
    }
  }

  // 🎯 deadline gần
  if (item.deadline) {
    const diff = (new Date(item.deadline) - new Date()) / (1000 * 60 * 60 * 24);
    if (diff > 0 && diff < 60) {
      reasons.push("deadline sắp tới");
    }
  }

  // 🎯 journal chất lượng
  if (item.sjr_best_quartile === "Q1") {
    reasons.push("tạp chí chất lượng cao (Q1)");
  }

  // 🎯 fallback
  if (!reasons.length) {
    reasons.push("phù hợp nội dung tìm kiếm");
  }

  return `💡 ${reasons.join(", ")}`;
}

// ================= FORMAT =================
function formatFinalAnswer(answer, conferences, journals, analysis) {
  let content = answer || "";

  if (conferences.length) {
    content += `\n\n## 🎓 Hội thảo liên quan\n\n`;

    conferences.forEach((c, i) => {
      const title = c.name || c.title;

      content += `### ${i + 1}. **[C${i + 1}] ${safe(title)}**  
- 📍 ${[c.city, c.country].filter(Boolean).join(", ") || "N/A"}  
`;

      if (c.deadline) {
        content += `- 📅 ${safe(c.deadline)}  \n`;
      }

      // 🔥 explain
      content += `- ${buildExplain(c, analysis)}  \n`;
    });

    content += `\n## 🔗 Link hội thảo\n\n`;

    conferences.forEach((c, i) => {
      const title = c.name || c.title;
      const url = getConferenceUrl(c);

      content += `- **[C${i + 1}] ${safe(title)}**  
  👉 ${url ? `[🌐 Xem CFP / Website](${url})` : "⚠️ Chưa có link"}\n\n`;
    });
  }

  if (journals.length) {
    content += `\n## 📚 Tạp chí liên quan\n\n`;

    journals.forEach((j, i) => {
      content += `### ${i + 1}. **[J${i + 1}] ${safe(j.title)}**  
- 🏢 ${safe(j.publisher)}  
- 🏆 ${safe(j.sjr_best_quartile)}  
- 🌍 ${safe(j.country)}  
`;

      // 🔥 explain
      content += `- ${buildExplain(j, analysis)}  \n`;
    });

    content += `\n## 🔗 Link tạp chí\n\n`;

    journals.forEach((j, i) => {
      const url = getJournalUrl(j);

      content += `- **[J${i + 1}] ${safe(j.title)}**  
  👉 ${url ? `[Xem trên Scimago](${url})` : "Không có link"}\n\n`;
    });
  }

  return content;
}

// ================= SUMMARY =================
function buildSmartSummary(question, conferences, journals, analysis) {
  const total = conferences.length + journals.length;

  if (!total) return "Không tìm thấy dữ liệu phù hợp.";

  let intro = "";

  if (conferences.length && journals.length) {
    intro = "Dựa trên yêu cầu của bạn, hệ thống đã phân tích và chọn ra các hội thảo và tạp chí phù hợp.";
  } else if (conferences.length) {
    intro = "Dựa trên yêu cầu của bạn, dưới đây là các hội thảo phù hợp.";
  } else {
    intro = "Dựa trên yêu cầu của bạn, dưới đây là các tạp chí phù hợp.";
  }

  let reasoning = "";

  if (analysis?.wantsCountryCode) {
    reasoning += " Kết quả được ưu tiên theo khu vực bạn quan tâm.";
  }

  if (analysis?.fieldHint) {
    reasoning += " Các kết quả tập trung vào lĩnh vực chuyên môn liên quan.";
  }

  return `${intro}${reasoning}`;
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

    conferences = smartSelect(sortByScore(conferences), topk);
    journals = smartSelect(sortByScore(journals), topk);

    const answer = buildSmartSummary(question, conferences, journals, analysis);
    const finalAnswer = formatFinalAnswer(answer, conferences, journals, analysis);

    return {
      answer: finalAnswer,
      content_markdown: finalAnswer,
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
      content_markdown: "Hệ thống đang gặp lỗi.",
      conferences: [],
      journals: [],
      domain: "error",
      analysis: {},
      responseTimeMs: Date.now() - start
    };
  }
}