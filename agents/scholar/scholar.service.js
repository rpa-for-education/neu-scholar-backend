// scholar.service.js
import { runAgent } from "./scholar.agent.js";
import { callLLM } from "../shared/llm.js";
import { getSessionHistory, addToHistory } from "../../middlewares/session.js";
import { buildScholarPrompt } from "./scholar.prompt.js";

export async function runScholarAgent(req, question, model_id, topk) {
  const history = getSessionHistory(req);

  const result = await runAgent(question, topk);

  if (!result.conferences.length && !result.journals.length) {
    return {
      answer: "Không tìm thấy dữ liệu phù hợp trong hệ thống.",
      conferences: [],
      journals: [],
      domain: "empty"
    };
  }

  const prompt = buildScholarPrompt(
    question,
    result.conferences,
    result.journals,
    history
  );

  const llm = await callLLM(prompt, model_id);
  const answer = llm.answer || "";

  addToHistory(req, question, answer);

  return {
    answer,
    conferences: result.conferences,
    journals: result.journals,
    domain: result.domain || "general"
  };
}