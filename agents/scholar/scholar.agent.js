import { searchConferenceJournalByVector } from "./scholar.search.js";
import { callLLM } from "../shared/llm.js";
import { detectDomain, analyzeQuestion } from "./agentReasoning.js";

import { rankItems, smartFilter } from "./scholar.ranking.js";
import { rerankWithLLM } from "./scholar.rerank.js";

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

// ================= DEDUPE =================
function dedupe(items, key = "title") {
  const map = new Map();

  for (const it of items) {
    const k = (it[key] || it.name || "").toLowerCase();
    if (!k) continue;
    if (!map.has(k)) map.set(k, it);
  }

  return [...map.values()];
}

// ================= FORMAT =================
function formatFinalAnswer(answer, conferences, journals) {
  let content = answer || "";

  // ===== CONFERENCE =====
  if (conferences.length) {
    content += `\n\n## 🎓 Hội thảo liên quan\n\n`;

    conferences.forEach((c, i) => {
      content += `### ${i + 1}. **[C${i + 1}] ${safe(c.name)}**  
- 📍 ${[c.city, c.country].filter(Boolean).join(", ") || "N/A"}  
- 📅 ${safe(c.deadline) || "N/A"}  
`;
    });

    content += `\n## 🔗 Link hội thảo\n\n`;

    conferences.forEach((c, i) => {
      const url = getConferenceUrl(c);

      content += `- **[C${i + 1}] ${safe(c.name)}**  
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

    const res = await searchConferenceJournalByVector({
      question,
      topk: MAX_CANDIDATES,
    });

    let conferences = dedupe(res.conferences || [], "name");
    let journals = dedupe(res.journals || [], "title");

    // ===== SMART RANK =====
    conferences = smartFilter(rankItems(conferences, question));
    journals = smartFilter(rankItems(journals, question));

    // ===== LLM RERANK =====
    conferences = await rerankWithLLM(conferences, question, topk);
    journals = await rerankWithLLM(journals, question, topk);

    // ===== LLM SUMMARY (SAFE) =====
    let answer = "";

    try {
      const llm = await callLLM(`
Viết tối đa 2 câu mô tả ngắn gọn.
KHÔNG liệt kê danh sách.
KHÔNG format markdown.

Câu hỏi: ${question}
      `);

      answer = llm?.answer || "";
    } catch {}

    if (!answer || answer.length > 300) {
      answer = "Dưới đây là các hội thảo và tạp chí phù hợp với yêu cầu của bạn.";
    }

    // ===== FINAL FORMAT =====
    const finalAnswer = formatFinalAnswer(answer, conferences, journals);

    // ===== DEBUG (có thể tắt) =====
    console.log("✅ FINAL ANSWER:\n", finalAnswer);

    return {
      answer: finalAnswer,
      content_markdown: finalAnswer, // 🔥 FIX QUAN TRỌNG
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