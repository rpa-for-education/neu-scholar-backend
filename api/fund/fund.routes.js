import { runFundAgentCore } from "./fund.agent.js"; // 🔥 bạn đang có
import { callLLM } from "../shared/llm.js";
import { getSessionHistory, addToHistory } from "../../middlewares/session.js";
import { buildFundPrompt } from "./fund.prompt.js";

export async function runFundAgent(req, question, model_id, topk) {
  const start = Date.now();

  try {
    const history = getSessionHistory(req) || [];

    // 🔍 SEARCH
    const result = await runFundAgentCore(question, topk);

    const funds = result?.funds || [];

    if (!funds.length) {
      return {
        model_id,
        answer: "Không tìm thấy quỹ phù hợp.",
        retrieved: {
          funds: []
        },
        domain: "empty",
        analysis: {},
        responseTimeMs: Date.now() - start
      };
    }

    // 🧠 PROMPT
    const prompt = buildFundPrompt(question, funds, history);

    let answer = "";

    try {
      const llm = await callLLM(prompt, model_id);
      answer = llm?.answer || "";
    } catch (err) {
      console.error("❌ Fund LLM error:", err.message);
    }

    if (!answer || answer.trim().length < 10) {
      answer = "Dưới đây là các quỹ phù hợp bạn có thể tham khảo.";
    }

    try {
      addToHistory(req, question, answer);
    } catch {}

    return {
      model_id,
      answer,
      retrieved: {
        funds
      },
      domain: result?.domain || "fund",
      analysis: result?.analysis || {},
      responseTimeMs: Date.now() - start
    };

  } catch (err) {
    console.error("❌ Fund agent crash:", err);

    return {
      model_id,
      answer: "Hệ thống đang gặp lỗi.",
      retrieved: {
        funds: []
      },
      domain: "error",
      analysis: {},
      responseTimeMs: Date.now() - start
    };
  }
}