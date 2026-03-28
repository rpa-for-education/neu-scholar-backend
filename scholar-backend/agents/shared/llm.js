// llm.js
import axios from "axios";

// ================= CONFIG =================
const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434").replace(/\/$/, "");
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";
const DEFAULT_MODEL_ID = "qwen3-8b";

// ===== MODEL MAP =====
export const modelMap = {
  "qwen3-8b": { provider: "ollama", model: "qwen3:8b" },

  // 👉 mở rộng sau nếu cần
  // "mistral-7b": { provider: "ollama", model: "mistral:7b" },
};

// ================= LOW LEVEL CALL =================
async function callOllamaRaw(messages, model) {
  const start = Date.now();

  try {
    const res = await axios.post(
      `${OLLAMA_BASE}/api/chat`,
      {
        model: model || DEFAULT_MODEL,
        messages,
        stream: false,
        options: {
          temperature: 0.2,
        },
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 120000,
      }
    );

    const latency = Date.now() - start;

    return {
      content: res.data?.message?.content || "",
      latency,
    };

  } catch (err) {
    console.error("❌ Ollama RAW error:", err.response?.data || err.message);

    throw new Error(
      err.response?.data?.error || err.message || "Ollama request failed"
    );
  }
}

// ================= SAFE JSON PARSE =================
function safeJSONParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    return null;
  }
}

// ================= GENERIC CALL =================
export async function callLLM(prompt, model_id = DEFAULT_MODEL_ID) {
  const info = modelMap[model_id];

  if (!info) {
    throw new Error(`Invalid model_id: ${model_id}`);
  }

  const model = info.model;

  console.log(`⚡ callLLM → model_id=${model_id} | model=${model}`);

  try {
    const res = await callOllamaRaw(
      [{ role: "user", content: prompt }],
      model
    );

    return {
      provider: "ollama",
      model_id,
      model,
      latency: res.latency,
      answer: res.content || "",
    };

  } catch (err) {
    console.error("❌ LLM error:", err.message);

    return {
      provider: "ollama",
      model_id,
      model,
      latency: null,
      answer: "",
      error: err.message,
    };
  }
}

// ================= JSON MODE =================
export async function callLLMJson(prompt, model_id = DEFAULT_MODEL_ID) {
  const strictPrompt = `
You MUST return valid JSON only.
No explanation.
No markdown.

${prompt}
`;

  const res = await callLLM(strictPrompt, model_id);

  const parsed = safeJSONParse(res.answer);

  if (!parsed) {
    console.error("❌ JSON parse failed. Raw:", res.answer);
    throw new Error("LLM JSON parse failed");
  }

  return parsed;
}

// ================= QUERY REWRITE =================
export async function rewriteQueryLLM(question) {
  const prompt = `
Rewrite the query into 3 optimized academic search queries.

Focus on:
- conference
- journal
- research topics

Question:
"${question}"

Return JSON:
{
  "queries": ["...", "...", "..."]
}
`;

  try {
    const data = await callLLMJson(prompt);
    return data.queries?.length ? data.queries : [question];
  } catch (err) {
    console.warn("⚠️ rewrite fallback:", err.message);
    return [question];
  }
}

// ================= RERANK =================
export async function rerankLLM(query, items) {
  if (!items?.length) return items;

  const prompt = `
You are an academic ranking system.

Query:
"${query}"

Rank the items by relevance (best first).

Return JSON array of indices.

Items:
${items.map((it, i) =>
  `[${i}] ${it.title || it.name} | ${it.topics || it.areas || ""}`
).join("\n")}
`;

  try {
    const order = await callLLMJson(prompt);

    return order
      .map(i => items[i])
      .filter(Boolean);

  } catch (err) {
    console.warn("⚠️ rerank fallback:", err.message);
    return items;
  }
}