// scholar.stream.js
import fetch from "node-fetch";
import { runAgent } from "./scholar.agent.js";
import { getSessionHistory, addToHistory } from "../../middlewares/session.js";
import { buildScholarPrompt } from "./scholar.prompt.js";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;

export async function streamScholar(req, res, question, topk = 5) {
  const history = getSessionHistory(req);
  const result = await runAgent(question, topk);

  if (!result.conferences.length && !result.journals.length) {
    res.write(`data: Không có dữ liệu\n\n`);
    return res.end();
  }

  const prompt = buildScholarPrompt(
    question,
    result.conferences,
    result.journals,
    history
  );

  const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen3:8b",
      messages: [{ role: "user", content: prompt }],
      stream: true,
    }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let finalText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);

    for (const line of chunk.split("\n")) {
      if (!line.trim()) continue;

      try {
        const json = JSON.parse(line);
        const token = json.message?.content || "";

        finalText += token;
        res.write(`data: ${token}\n\n`);
      } catch {}
    }
  }

  addToHistory(req, question, finalText);

  res.write(`data: [DONE]\n\n`);
  res.end();
}