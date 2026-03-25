import { searchConferenceJournalByVector } from "./scholar.search.js";
import { callLLM } from "../shared/llm.js";
import { detectDomain, analyzeQuestion } from "./agentReasoning.js";

// 🔥 dùng ranking đã gộp
import { rankItems, smartFilter, rerankWithLLM } from "./scholar.ranking.js";

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
  return c.url || "";
}

function getJournalUrl(j) {
  return j.scimago_link || "";
}

// ================= 🔥 FIXED DEDUPE =================
function dedupe(items) {
  const map = new Map();

  for (const it of items) {
    const key = (
      it.title ||
      it.name ||
      it.acronym ||
      ""
    ).toLowerCase();

    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, it);
    }
  }

  return [...map.values()];
}

// ================= SAFE RERANK =================
async function safeRerank(items, question, topk) {
  try {
    const r = await rerankWithLLM(items, question, topk);

    if (!r || !r.length) {
      console.warn("⚠️ rerank empty → fallback");
      return items.slice(0, topk);
    }

    return r;

  } catch (err) {
    console.warn("⚠️ rerank fail → fallback:", err.message);
    return items.slice(0, topk);
  }
}

// ================= FORMAT =================
function formatFinalAnswer(answer, conferences, journals) {
  let content = answer || "";

  // ===== CONFERENCE =====
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
  👉 ${url ? `[Xem chi tiết](${url})` : "Không có link"}\n\n`;
    });
  }

  // ===== JOURNAL =====
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

// ================= MAIN =================
export async function runAgent(question, topk = FINAL_TOPK) {
  const start = Date.now();

  try {
    const domain = detectDomain(question);
    const analysis = analyzeQuestion(question);

    // 🔍 SEARCH
    const res = await searchConferenceJournalByVector({
      question,
      topk: MAX_CANDIDATES,
    });

    let conferences = dedupe(res.conferences || []);
    let journals = dedupe(res.journals || []);

    console.log("📊 BEFORE RANK:", conferences.length, journals.length);

    // ===== RANK =====
    conferences = smartFilter(rankItems(conferences, question, analysis));
    journals = smartFilter(rankItems(journals, question, analysis));

    console.log("📊 AFTER RANK:", conferences.length, journals.length);

    // ===== SAFE RERANK =====
    conferences = await safeRerank(conferences, question, topk);
    journals = await safeRerank(journals, question, topk);

    console.log("📊 AFTER RERANK:", conferences.length, journals.length);

    // ===== LLM SUMMARY =====
    let answer = "";

    try {
      const llm = await callLLM(`
Viết tối đa 2 câu mô tả ngắn gọn.
KHÔNG liệt kê danh sách.
KHÔNG format markdown.

Câu hỏi: ${question}
      `);

      answer = llm?.answer || "";
    } catch {
      console.warn("⚠️ summary fail");
    }

    if (!answer || answer.length > 300) {
      answer = "Dưới đây là các hội thảo và tạp chí phù hợp với yêu cầu của bạn.";
    }

    const finalAnswer = formatFinalAnswer(answer, conferences, journals);

    console.log("✅ FINAL ANSWER OK");

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