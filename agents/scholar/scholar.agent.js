// scholar.agent.js
import { searchConferenceJournalByVector } from "./scholar.search.js";
import { callLLM } from "../shared/llm.js";
import { getDb } from "../../db/mongo.js";
import { detectDomain, analyzeQuestion } from "./agentReasoning.js";

// ================= CONFIG =================
const MAX_CANDIDATES = 15; // 🔥 giảm từ 30 → 15
const FINAL_TOPK = 5;

// ================= SAFE STRING =================
function safeLower(x) {
  return (x || "").toString().toLowerCase();
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

  const safe = escapeRegex(question);
  const regex = new RegExp(safe, "i");

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

    // ================= SORT (THAY RERANK LLM) =================
    conferences.sort((a, b) => (b.score || 0) - (a.score || 0));
    journals.sort((a, b) => (b.score || 0) - (a.score || 0));

    // ================= BUILD PROMPT =================
    let context = `
Bạn là AI tư vấn học thuật.
Chỉ dùng dữ liệu dưới đây. Không bịa.

`;

    conferences.slice(0, FINAL_TOPK).forEach((c, i) => {
      context += `[C${i + 1}] ${c.name} | ${c.city || ""} ${c.country || ""}\n`;
    });

    journals.slice(0, FINAL_TOPK).forEach((j, i) => {
      context += `[J${i + 1}] ${j.title} | ${j.publisher || ""}\n`;
    });

    context += `\nCâu hỏi: ${question}`;

    // ================= FINAL LLM (CHỈ 1 LẦN) =================
    let answer = "";

    try {
      const llm = await callLLM(context);
      answer = llm?.answer || "";
    } catch (err) {
      console.error("❌ LLM error:", err.message);
    }

    // 🔥 fallback nếu LLM fail
    if (!answer || answer.trim().length < 10) {
      answer = `Tôi đã tìm thấy ${conferences.length + journals.length} kết quả liên quan. Xem danh sách bên dưới.`;
    }

    return {
      answer,
      conferences: conferences.slice(0, topk),
      journals: journals.slice(0, topk),
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