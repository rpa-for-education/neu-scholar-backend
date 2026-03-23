import { runAgent } from "./scholar.agent.js";
import { callLLM } from "../shared/llm.js";
import { getSessionHistory, addToHistory } from "../../middlewares/session.js";
import { buildScholarPrompt } from "./scholar.prompt.js";

export async function runScholarAgent(req, question, model_id, topk) {
  const start = Date.now();

  try {
    const history = getSessionHistory(req) || [];

    // 🔍 SEARCH + reasoning
    const result = await runAgent(question, topk);

    const conferences = result?.conferences || [];
    const journals = result?.journals || [];

    // 👉 empty
    if (!conferences.length && !journals.length) {
      return {
        model_id,
        answer: "Không tìm thấy dữ liệu phù hợp trong hệ thống.",
        retrieved: {
          conferences: [],
          journals: []
        },
        domain: "empty",
        analysis: {},
        responseTimeMs: Date.now() - start
      };
    }

    // 🧠 BUILD PROMPT
    const prompt = buildScholarPrompt(
      question,
      conferences,
      journals,
      history
    );

    let answer = "";

    try {
      const llm = await callLLM(prompt, model_id);
      answer = llm?.answer || llm?.response || "";
    } catch (err) {
      console.error("❌ LLM error:", err.message);
    }

    // 🔥 fallback
    if (!answer || answer.trim().length < 10) {
      answer =
        "Tôi đã tìm thấy một số hội thảo/tạp chí liên quan. Bạn có thể tham khảo danh sách bên dưới.";
    }

    // 💾 history
    try {
      addToHistory(req, question, answer);
    } catch {}

    return {
      model_id,
      answer,
      retrieved: {
        conferences,
        journals
      },
      domain: result?.domain || "general",
      analysis: result?.analysis || {},
      responseTimeMs: Date.now() - start
    };

  } catch (err) {
    console.error("❌ Scholar agent crash:", err);

    return {
      model_id,
      answer: "Hệ thống đang gặp lỗi, vui lòng thử lại sau.",
      retrieved: {
        conferences: [],
        journals: []
      },
      domain: "error",
      analysis: {},
      responseTimeMs: Date.now() - start
    };
  }
}