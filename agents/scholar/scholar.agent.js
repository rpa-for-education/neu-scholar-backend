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
    us: "united states"
  };
  const n = normalizeText(c);
  return map[n] || n;
}

// ================= URL =================
function getConferenceUrl(c) {
  let url =
    c.cfp_link ||
    c.url ||
    c.link ||
    c.website ||
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

// ================= 🔥 FIELD MATCH =================
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

  let score = 0;

  if (text.includes(field)) score += 1;

  const tokens = field.split(" ");
  for (const t of tokens) {
    if (text.includes(t)) score += 0.5;
  }

  return score;
}

// ================= 🔥 EXPLAIN =================
function buildExplain(item, analysis) {
  const reasons = [];
  const now = Date.now();

  const deadline = safeTime(item.deadline);
  const start = safeTime(item.start_date);

  // ===== DEADLINE =====
  if (deadline) {
    const diff = (deadline - now) / (1000 * 60 * 60 * 24);

    if (diff > 0 && diff < 14) {
      reasons.push("🔥 Sắp hết hạn nộp bài");
    } else if (diff > 0 && diff < 60) {
      reasons.push("⏳ Còn hạn nộp bài");
    } else if (diff > 60) {
      reasons.push("📢 Đang mở nhận bài");
    } else if (diff < 0 && diff > -30) {
      reasons.push("⚠️ Vừa hết hạn");
    } else if (diff < -30) {
      reasons.push("❌ Đã hết hạn");
    }
  }

  // ===== EVENT =====
  if (start) {
    const diff = (start - now) / (1000 * 60 * 60 * 24);

    if (diff > 0 && diff < 30) {
      reasons.push("📅 Sắp diễn ra");
    }
  }

  // ===== FIELD =====
  if (analysis?.fieldHint) {
    const score = fieldMatch(item, analysis.fieldHint);
    if (score > 0) {
      reasons.push("🎯 Đúng lĩnh vực");
    }
  }

  // ===== QUALITY =====
  if (item.sjr_best_quartile === "Q1") {
    reasons.push("🏆 Q1 (chất lượng cao)");
  }

  // ===== COUNTRY =====
  if (analysis?.wantsCountryCode) {
    const itemCountry = normalizeCountry(item.country);
    const target = normalizeCountry(analysis.wantsCountryCode);

    if (itemCountry.includes(target)) {
      reasons.push("🌍 Đúng khu vực");
    }
  }

  if (!reasons.length) {
    reasons.push("Phù hợp nội dung tìm kiếm");
  }

  return `💡 ${reasons.join(", ")}`;
}

// ================= ANALYSIS =================
function buildAnalysis(question, conferences, journals, analysis) {
  const total = conferences.length + journals.length;
  if (!total) return "";

  let text = `Dựa trên truy vấn "${question}", hệ thống đã lọc ra ${total} kết quả phù hợp nhất. `;

  if (analysis?.fieldHint) {
    text += "Các kết quả phù hợp với lĩnh vực chuyên môn. ";
  }

  const hasOpen = conferences.some(c => {
    const d = safeTime(c.deadline);
    return d && d > Date.now();
  });

  if (hasOpen) {
    text += "Một số hội thảo vẫn đang nhận bài. ";
  }

  text += "Ưu tiên các kết quả gần deadline và độ phù hợp cao.";

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
        content += `- ⏳ Deadline: ${safe(c.deadline)}  \n`;
      }

      if (c.start_date) {
        content += `- 📅 Event: ${safe(c.start_date)}  \n`;
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

    conferences = smartFilter(rankItems(conferences, question, analysis)).slice(0, topk);
    journals = smartFilter(rankItems(journals, question, analysis)).slice(0, topk);

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