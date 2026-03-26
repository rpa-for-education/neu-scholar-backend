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
    const q = encodeURIComponent((c.title || c.name) + " conference");
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

// ================= FORMAT =================
function formatFinalAnswer(answer, conferences, journals) {
  let content = answer || "";

  if (conferences.length) {
    content += `\n\n## 🎓 Hội thảo liên quan\n\n`;

    conferences.forEach((c, i) => {
      const title = c.name || c.title;

      content += `### ${i + 1}. **[C${i + 1}] ${safe(title)}**  
- 📍 ${[c.city, c.country].filter(Boolean).join(", ") || "N/A"}  
- 📅 ${safe(c.deadline) || "N/A"}  
`;
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
function buildFastSummary(question, conferences, journals) {
  const total = conferences.length + journals.length;

  if (!total) return "Không tìm thấy dữ liệu phù hợp.";

  return `Dưới đây là ${total} kết quả phù hợp với "${question}".`;
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

    console.log("📊 BEFORE:", conferences.length, journals.length);

    // 🔥 KHÔNG rank lại — dùng reasoningScore từ backend
    conferences = smartSelect(conferences, topk);
    journals = smartSelect(journals, topk);

    console.log("📊 FINAL:", conferences.length, journals.length);

    const answer = buildFastSummary(question, conferences, journals);
    const finalAnswer = formatFinalAnswer(answer, conferences, journals);

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