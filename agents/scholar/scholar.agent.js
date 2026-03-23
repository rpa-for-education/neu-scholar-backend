// scholar.agent.js
import { searchConferenceJournalByVector } from "./scholar.search.js";
import { callLLM } from "../shared/llm.js";
import { getDb } from "../../db/mongo.js";
import { detectDomain, analyzeQuestion } from "./agentReasoning.js";

// ================= CONFIG =================
const MAX_CANDIDATES = 15;
const FINAL_TOPK = 5;

// ================= SAFE =================
function safe(x) {
  if (!x) return "";
  if (Array.isArray(x)) return x.join(", ");
  if (typeof x === "object") return JSON.stringify(x);
  return String(x);
}

function safeLower(x) {
  return safe(x).toLowerCase();
}

// ================= DEDUPE =================
function dedupe(items, key = "title") {
  const map = new Map();

  for (const it of items) {
    const k = safeLower(it[key] || it.name);
    if (!k) continue;

    if (!map.has(k)) map.set(k, it);
  }

  return [...map.values()];
}

// ================= ESCAPE REGEX =================
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ================= KEYWORD FALLBACK =================
async function keywordSearch(question) {
  const db = await getDb();

  const safeQ = escapeRegex(question);
  const regex = new RegExp(safeQ, "i");

  const journals = await db.collection("journal")
    .find({ title: regex })
    .limit(10)
    .toArray();

  const conferences = await db.collection("conference")
    .find({ name: regex })
    .limit(10)
    .toArray();

  return { journals, conferences };
}

// ================= FORMAT OUTPUT (🔥 NEW) =================
function formatFinalAnswer(answer, conferences, journals) {
  let content = answer || "";

  // ===== CONFERENCE SECTION =====
  if (conferences.length) {
    content += `\n\n## 🎓 Hội thảo liên quan\n\n`;

    conferences.forEach((c, i) => {
      const deadline = c.deadline || "N/A";
      const country = c.country || "";
      const city = c.city || "";

      let badge = "";
      if (c.deadline) {
        const days =
          (new Date(c.deadline) - new Date()) / (1000 * 60 * 60 * 24);

        if (days < 30) badge = "🔥 Sắp hết hạn";
        else if (days < 90) badge = "⏳ Còn hạn gần";
      }

      content += `### ${i + 1}. [C${i + 1}] ${safe(c.name)}  
- 📍 ${city} ${country}  
- 📅 ${deadline} ${badge}  
`;
    });

    // ===== LINKS =====
    content += `\n## 🔗 Link hội thảo\n\n`;

    conferences.forEach((c, i) => {
      content += `- [C${i + 1}] ${safe(c.name)}  
  👉 ${safe(c.url) || "#"}\n\n`;
    });
  }

  // ===== JOURNAL SECTION =====
  if (journals.length) {
    content += `\n## 📚 Tạp chí liên quan\n\n`;

    journals.forEach((j, i) => {
      content += `### ${i + 1}. [J${i + 1}] ${safe(j.title)}  
- 🏢 ${safe(j.publisher)}  
- 🏆 ${safe(j.sjr_best_quartile)}  
`;
    });

    content += `\n## 🔗 Link tạp chí\n\n`;

    journals.forEach((j, i) => {
      content += `- [J${i + 1}] ${safe(j.title)}  
  👉 ${safe(j.scimago_link) || "#"}\n\n`;
    });
  }

  return content;
}

// ================= MAIN =================
export async function runAgent(question, topk = FINAL_TOPK) {
  const start = Date.now();

  try {
    if (!question || typeof question !== "string") {
      throw new Error("Invalid question");
    }

    console.log("🧠 Question:", question);

    const domain = detectDomain(question);
    const analysis = analyzeQuestion(question);

    // ================= SEARCH =================
    const res = await searchConferenceJournalByVector({
      question,
      topk: MAX_CANDIDATES,
    });

    let conferences = res.conferences || [];
    let journals = res.journals || [];

    console.log("📦 Vector results:", conferences.length, journals.length);

    // ================= FALLBACK =================
    const keyword = await keywordSearch(question);

    conferences = [...conferences, ...keyword.conferences];
    journals = [...journals, ...keyword.journals];

    // ================= CLEAN =================
    conferences = dedupe(conferences, "name");
    journals = dedupe(journals, "title");

    // ================= GUARD =================
    if (!conferences.length && !journals.length) {
      return {
        answer: "Không tìm thấy dữ liệu phù hợp trong hệ thống.",
        conferences: [],
        journals: [],
        domain: "empty",
        analysis,
        responseTimeMs: Date.now() - start
      };
    }

    // ================= SORT =================
    conferences.sort((a, b) => (b.score || 0) - (a.score || 0));
    journals.sort((a, b) => (b.score || 0) - (a.score || 0));

    const topConfs = conferences.slice(0, topk);
    const topJournals = journals.slice(0, topk);

    // ================= BUILD PROMPT =================
    let context = `
Bạn là AI tư vấn học thuật.
Chỉ dùng dữ liệu dưới đây. Không bịa.

`;

    topConfs.forEach((c, i) => {
      context += `[C${i + 1}] ${safe(c.name)} | ${safe(c.country)}\n`;
    });

    topJournals.forEach((j, i) => {
      context += `[J${i + 1}] ${safe(j.title)} | ${safe(j.publisher)}\n`;
    });

    context += `\nCâu hỏi: ${question}`;

    // ================= LLM =================
    let answer = "";

    try {
      const llm = await callLLM(context);
      answer = llm?.answer || "";
    } catch (err) {
      console.error("❌ LLM error:", err.message);
    }

    if (!answer || answer.trim().length < 10) {
      answer = `Tôi đã tìm thấy ${topConfs.length + topJournals.length} kết quả liên quan.`;
    }

    // ================= FORMAT FINAL (🔥 KEY) =================
    const finalAnswer = formatFinalAnswer(
      answer,
      topConfs,
      topJournals
    );

    return {
      answer: finalAnswer,
      conferences: topConfs,
      journals: topJournals,
      domain,
      analysis,
      responseTimeMs: Date.now() - start
    };

  } catch (err) {
    console.error("❌ Agent error:", err);

    return {
      answer: "Hệ thống đang gặp lỗi. Vui lòng thử lại.",
      conferences: [],
      journals: [],
      domain: "error",
      analysis: {},
      responseTimeMs: Date.now() - start
    };
  }
}