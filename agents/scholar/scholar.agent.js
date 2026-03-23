// agent/agent.js
import { searchConferenceJournalByVector } from "./scholar.search.js";
import { callLLM } from "../shared/llm.js";
import { getDb } from "../../db/mongo.js";
import { detectDomain, analyzeQuestion } from "./agentReasoning.js";

// ================= CONFIG =================
const MAX_CANDIDATES = 30;
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

// ================= SAFE JSON =================
function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ================= RERANK =================
async function rerankWithLLM(question, items) {
  if (!items.length) return [];

  const prompt = `
Bạn là AI chọn lọc dữ liệu.

Câu hỏi:
${question}

Danh sách:
${items.map((it, i) => `[${i}] ${it.title || it.name}`).join("\n")}

Chọn TOP ${FINAL_TOPK}.

Chỉ trả JSON:
{"indexes":[0,1,2]}
`;

  try {
    const res = await callLLM(prompt);

    const json = safeParseJSON(res.answer);

    if (!json?.indexes) return items.slice(0, FINAL_TOPK);

    return json.indexes.map(i => items[i]).filter(Boolean);

  } catch {
    return items.slice(0, FINAL_TOPK);
  }
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
        domain: "empty"
      };
    }

    // ================= RERANK =================
    conferences = await rerankWithLLM(question, conferences);
    journals = await rerankWithLLM(question, journals);

    // ================= BUILD PROMPT =================
    let context = `
Bạn là AI tư vấn học thuật.
Chỉ dùng dữ liệu dưới đây. Không bịa.

`;

    conferences.forEach((c, i) => {
      context += `[C${i + 1}] ${c.name} | ${c.city || ""} ${c.country || ""}\n`;
    });

    journals.forEach((j, i) => {
      context += `[J${i + 1}] ${j.title} | ${j.publisher || ""}\n`;
    });

    context += `\nCâu hỏi: ${question}`;

    // ================= FINAL LLM =================
    const llm = await callLLM(context);

    return {
      answer: llm.answer || "",
      conferences: conferences.slice(0, topk),
      journals: journals.slice(0, topk),
      domain,
      responseTimeMs: Date.now() - start
    };

  } catch (err) {
    console.error("❌ Agent error:", err);

    return {
      answer: "Hệ thống đang gặp lỗi. Vui lòng thử lại.",
      conferences: [],
      journals: [],
      domain: "error"
    };
  }
}