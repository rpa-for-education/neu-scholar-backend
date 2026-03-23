import { searchConferenceJournalByVector } from "./scholar.search.js";
import { callLLM } from "../shared/llm.js";
import { getDb } from "../../db/mongo.js";
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

  if (conferences.length) {
    content += `\n\n## 🎓 Hội thảo\n\n`;

    conferences.forEach((c, i) => {
      content += `### ${i + 1}. ${safe(c.name)}
- 📍 ${safe(c.country)}
- 📅 ${safe(c.deadline)}

`;
    });

    content += `## 🔗 Link hội thảo\n\n`;

    conferences.forEach((c) => {
      content += `- ${safe(c.name)}  
👉 ${safe(c.url)}\n\n`;
    });
  }

  if (journals.length) {
    content += `\n## 📚 Tạp chí\n\n`;

    journals.forEach((j, i) => {
      content += `### ${i + 1}. ${safe(j.title)}
- 🏆 ${safe(j.sjr_best_quartile)}
- 🏢 ${safe(j.publisher)}

`;
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

    // ================= SMART RANK =================
    conferences = smartFilter(rankItems(conferences, question));
    journals = smartFilter(rankItems(journals, question));

    // ================= LLM RERANK =================
    conferences = await rerankWithLLM(conferences, question, topk);
    journals = await rerankWithLLM(journals, question, topk);

    // ================= LLM SUMMARY =================
    let answer = "";

    try {
      const llm = await callLLM(`
Viết 2 câu tóm tắt ngắn gọn.
Câu hỏi: ${question}
      `);
      answer = llm?.answer || "";
    } catch {}

    if (!answer) answer = "Dưới đây là kết quả phù hợp.";

    return {
      answer: formatFinalAnswer(answer, conferences, journals),
      conferences,
      journals,
      domain,
      analysis,
      responseTimeMs: Date.now() - start
    };

  } catch (err) {
    console.error("❌ Agent error:", err);

    return {
      answer: "Lỗi hệ thống",
      conferences: [],
      journals: [],
      domain: "error",
      analysis: {},
      responseTimeMs: Date.now() - start
    };
  }
}