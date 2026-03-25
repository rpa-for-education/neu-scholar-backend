import { runAgent } from "./scholar.agent.js";
import { callLLM } from "../shared/llm.js";
import { getSessionHistory, addToHistory } from "../../middlewares/session.js";
import { buildScholarPrompt } from "./scholar.prompt.js";

export async function runScholarAgent(req, question, model_id, topk) {
  const start = Date.now();

  try {
    const history = getSessionHistory(req) || [];

    // 🔍 Step 1: search
    const result = await runAgent(question, topk);

    const conferences = result?.conferences || [];
    const journals = result?.journals || [];

    console.log("📊 SEARCH:", conferences.length, journals.length);

    // ❌ Không có dữ liệu → STOP luôn
    if (!conferences.length && !journals.length) {
      return {
        answer: "Không tìm thấy dữ liệu phù hợp trong hệ thống.",
        conferences: [],
        journals: [],
        sources: [], // 🔥 FIX
        domain: "empty",
        responseTimeMs: Date.now() - start
      };
    }

    // 🧠 Step 2: build prompt
    const prompt = buildScholarPrompt(
      question,
      conferences,
      journals,
      history
    );

    // 🤖 Step 3: call LLM
    let answer = "";

    try {
      const llm = await callLLM(prompt, model_id);
      answer = llm?.answer || llm?.response || "";
    } catch (err) {
      console.error("❌ LLM error:", err.message);
    }

    // 🔥 fallback nếu LLM fail
    if (!answer || answer.trim().length < 10) {
      answer =
        "Tôi đã tìm thấy một số hội thảo/tạp chí liên quan. Bạn có thể tham khảo danh sách bên dưới.";
    }

    // 🔥 BUILD SOURCES (QUAN TRỌNG NHẤT)
    const sources = [
      ...conferences.map((c, i) => ({
        id: `C${i + 1}`,
        type: "conference",
        title: c.title,
        url: c.url,
        metadata: {
          country: c.country,
          city: c.city,
          deadline: c.deadline,
        }
      })),
      ...journals.map((j, i) => ({
        id: `J${i + 1}`,
        type: "journal",
        title: j.title,
        url: j.url,
        metadata: {
          quartile: j.sjr_best_quartile,
          publisher: j.publisher,
        }
      }))
    ];

    console.log("📦 SOURCES:", sources.length);

    // 💾 lưu history
    try {
      addToHistory(req, question, answer);
    } catch {
      console.warn("⚠️ Cannot save history");
    }

    return {
      answer,
      conferences,
      journals,
      sources, // 🔥 FIX QUAN TRỌNG
      domain: result?.domain || "general",
      responseTimeMs: Date.now() - start
    };

  } catch (err) {
    console.error("❌ Scholar agent crash:", err);

    return {
      answer: "Hệ thống đang gặp lỗi, vui lòng thử lại sau.",
      conferences: [],
      journals: [],
      sources: [], // 🔥 FIX
      domain: "error",
      responseTimeMs: Date.now() - start
    };
  }
}