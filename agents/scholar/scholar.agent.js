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

// ================= SELECT =================
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

// ================= 🔥 BADGE =================
function getBadge(index) {
  if (index === 0) return "🥇 Top phù hợp nhất";
  if (index === 1) return "🔥 Nổi bật";
  if (index === 2) return "⭐ Đáng cân nhắc";
  return "";
}

// ================= 🔥 EXPLAIN =================
function buildExplain(item, analysis) {
  const reasons = [];

  if (analysis?.wantsCountryCode && item.country_code === analysis.wantsCountryCode) {
    reasons.push("Phù hợp khu vực yêu cầu");
  }

  if (analysis?.fieldHint) {
    const text = [
      item.topics,
      item.categories,
      item.areas,
      item.cfp_text
    ].join(" ").toLowerCase();

    if (text.includes(analysis.fieldHint.toLowerCase())) {
      reasons.push("Liên quan trực tiếp lĩnh vực");
    }
  }

  if (item.deadline) {
    const diff = (new Date(item.deadline) - new Date()) / (1000 * 60 * 60 * 24);
    if (diff > 0 && diff < 60) {
      reasons.push("Deadline sắp tới");
    }
  }

  if (item.sjr_best_quartile === "Q1") {
    reasons.push("Tạp chí chất lượng cao (Q1)");
  }

  if (!reasons.length) {
    reasons.push("Phù hợp nội dung tìm kiếm");
  }

  return `💡 ${reasons.join(", ")}`;
}

// ================= 🔥 ANALYSIS (NEW) =================
function buildAnalysis(question, conferences, journals, analysis) {
  const total = conferences.length + journals.length;

  if (!total) return "";

  let text = `Dựa trên truy vấn "${question}", hệ thống đã phân tích và lọc ra ${total} kết quả phù hợp nhất. `;

  if (analysis?.wantsCountryCode) {
    text += "Các kết quả có xu hướng tập trung theo khu vực bạn quan tâm, giúp tăng tính liên quan thực tiễn. ";
  }

  if (analysis?.fieldHint) {
    text += "Nội dung các hội thảo/tạp chí chủ yếu xoay quanh lĩnh vực chuyên môn được đề cập, đảm bảo độ phù hợp học thuật. ";
  }

  text += "Ngoài ra, một số lựa chọn nổi bật có deadline gần hoặc thuộc nhóm chất lượng cao, phù hợp để ưu tiên xem xét.";

  return text;
}

// ================= FORMAT =================
function formatFinalAnswer(answer, conferences, journals, analysis) {
  let content = answer || "";

  if (conferences.length) {
    content += `\n\n## 🎓 Hội thảo liên quan\n\n`;

    conferences.forEach((c, i) => {
      const title = c.name || c.title;
      const url = getConferenceUrl(c);
      const badge = getBadge(i);

      content += `### ${i + 1}. **[C${i + 1}] ${safe(title)}** ${badge}\n`;

      content += `- 📍 ${[c.city, c.country].filter(Boolean).join(", ") || "N/A"}  \n`;

      if (c.deadline) {
        content += `- 📅 ${safe(c.deadline)}  \n`;
      }

      content += `- ${buildExplain(c, analysis)}  \n`;
      content += `- 🌐 ${url ? `[Xem CFP / Website](${url})` : "⚠️ Chưa có link"}\n\n`;
    });
  }

  if (journals.length) {
    content += `\n## 📚 Tạp chí liên quan\n\n`;

    journals.forEach((j, i) => {
      const url = getJournalUrl(j);
      const badge = getBadge(i);

      content += `### ${i + 1}. **[J${i + 1}] ${safe(j.title)}** ${badge}\n`;

      content += `- 🏢 ${safe(j.publisher)}  \n`;
      content += `- 🏆 ${safe(j.sjr_best_quartile)}  \n`;
      content += `- 🌍 ${safe(j.country)}  \n`;

      content += `- ${buildExplain(j, analysis)}  \n`;
      content += `- 🌐 ${url ? `[Xem trên Scimago](${url})` : "⚠️ Không có link"}\n\n`;
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

    conferences = smartSelect(sortByScore(conferences), topk);
    journals = smartSelect(sortByScore(journals), topk);

    // 🔥 NEW: analysis paragraph
    const intro = buildAnalysis(question, conferences, journals, analysis);

    const finalAnswer = formatFinalAnswer(intro, conferences, journals, analysis);

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