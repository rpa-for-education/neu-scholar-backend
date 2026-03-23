// scholar.service.js
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

    // 👉 Không có dữ liệu
    if (!conferences.length && !journals.length) {
      return {
        answer: "Không tìm thấy dữ liệu phù hợp trong hệ thống.",
        conferences: [],
        journals: [],
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

    // 🤖 Step 3: call LLM (có fallback)
    let answer = "";

    try {
      const llm = await callLLM(prompt, model_id);
      answer = llm?.answer || llm?.response || "";
    } catch (err) {
      console.error("❌ LLM error:", err.message);
    }

    // 🔥 fallback nếu LLM fail hoặc trả rỗng
    if (!answer || answer.trim().length < 10) {
      answer =
        "Tôi đã tìm thấy một số hội thảo/tạp chí liên quan. Bạn có thể tham khảo danh sách bên dưới.";
    }

    // 💾 lưu history
    try {
      addToHistory(req, question, answer);
    } catch (err) {
      console.warn("⚠️ Cannot save history");
    }

    return {
      answer,
      conferences,
      journals,
      domain: result?.domain || "general",
      responseTimeMs: Date.now() - start
    };

  } catch (err) {
    console.error("❌ Scholar agent crash:", err);

    return {
      answer: "Hệ thống đang gặp lỗi, vui lòng thử lại sau.",
      conferences: [],
      journals: [],
      domain: "error",
      responseTimeMs: Date.now() - start
    };
  }
}