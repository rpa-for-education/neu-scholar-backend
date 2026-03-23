// fund.stream.js
import fetch from "node-fetch";
import { searchFund } from "./fund.search.js";
import { buildFundPrompt } from "./fund.prompt.js";
import { getSessionHistory, addToHistory } from "../../middlewares/session.js";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;

export async function streamFund(req, res, question, topk = 5) {
  const history = getSessionHistory(req);

  const results = await searchFund(question, topk);

  if (!results.length) {
    res.write(`data: Không có dữ liệu\n\n`);
    return res.end();
  }

  const funds = results.map(r => r.payload);

  const prompt = buildFundPrompt(question, funds, history);

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