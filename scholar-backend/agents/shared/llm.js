// agents/shared/llm.js
import axios from "axios";

// ================= CONFIG =================
const OLLAMA_LLM_BASE = (
  process.env.OLLAMA_LLM_BASE_URL ||
  "http://101.96.66.232:8037/ollama"
).replace(/\/$/, "");

const OLLAMA_LLM_SECKEY =
  process.env.OLLAMA_LLM_SECKEY || "";

const DEFAULT_MODEL =
  process.env.OLLAMA_MODEL ||
  "qwen2.5:14b-instruct-ctx16k";

const DEFAULT_MODEL_ID = "qwen2.5-14b";

// ================= MODEL MAP =================
export const modelMap = {
  "qwen2.5-14b": {
    provider: "ollama",
    model: "qwen2.5:14b-instruct-ctx16k"
  }
};

// ================= LOW LEVEL CALL =================
async function callOllamaRaw(prompt, model) {
  const start = Date.now();

  try {
    const res = await axios.post(
      `${OLLAMA_LLM_BASE}/api/generate`,
      {
        model: model || DEFAULT_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.2
        }
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-ollama-seckey": OLLAMA_LLM_SECKEY
        },
        timeout: 120000
      }
    );

    return {
      content: res.data?.response || "",
      latency: Date.now() - start
    };

  } catch (err) {
    console.error(
      "❌ Ollama RAW error:",
      err.response?.data || err.message
    );

    throw new Error(
      err.response?.data?.error ||
      err.message ||
      "Ollama request failed"
    );
  }
}

// ================= SAFE JSON PARSE =================
function safeJSONParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match =
      text?.match(/\{[\s\S]*\}|\[[\s\S]*\]/);

    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }

    return null;
  }
}

// ================= GENERIC CALL =================
export async function callLLM(
  prompt,
  model_id = DEFAULT_MODEL_ID
) {
  const finalModelId =
    modelMap[model_id]
      ? model_id
      : DEFAULT_MODEL_ID;

  if (finalModelId !== model_id) {
    console.warn(
      `⚠️ Unknown model_id=${model_id}, fallback → ${finalModelId}`
    );
  }

  const info = modelMap[finalModelId];
  const model = info.model;

  console.log(
    `⚡ callLLM → model_id=${finalModelId} | model=${model}`
  );

  try {
    const res = await callOllamaRaw(
      prompt,
      model
    );

    return {
      provider: "ollama",
      model_id: finalModelId,
      model,
      latency: res.latency,
      answer: res.content || ""
    };

  } catch (err) {
    console.error(
      "❌ LLM error:",
      err.message
    );

    return {
      provider: "ollama",
      model_id: finalModelId,
      model,
      latency: null,
      answer: "",
      error: err.message
    };
  }
}

// ================= JSON MODE =================
export async function callLLMJson(
  prompt,
  model_id = DEFAULT_MODEL_ID
) {
  const strictPrompt = `
You MUST return valid JSON only.
No explanation.
No markdown.

${prompt}
`;

  const res = await callLLM(
    strictPrompt,
    model_id
  );

  const parsed =
    safeJSONParse(res.answer);

  if (!parsed) {
    console.error(
      "❌ JSON parse failed. Raw:",
      res.answer
    );

    throw new Error(
      "LLM JSON parse failed"
    );
  }

  return parsed;
}

// ================= QUERY REWRITE =================
export async function rewriteQueryLLM(
  question,
  model_id = DEFAULT_MODEL_ID
) {
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
    const data =
      await callLLMJson(
        prompt,
        model_id
      );

    return data.queries?.length
      ? data.queries
      : [question];

  } catch (err) {
    console.warn(
      "⚠️ rewrite fallback:",
      err.message
    );

    return [question];
  }
}

// ================= RERANK =================
export async function rerankLLM(
  query,
  items,
  model_id = DEFAULT_MODEL_ID
) {
  if (!items?.length) {
    return items;
  }

  const prompt = `
You are an academic ranking system.

Query:
"${query}"

Rank the items by relevance (best first).

Return JSON array of indices.

Items:
${items
  .map(
    (it, i) =>
      `[${i}] ${it.title || it.name} | ${
        it.topics || it.areas || ""
      }`
  )
  .join("\n")}
`;

  try {
    const order =
      await callLLMJson(
        prompt,
        model_id
      );

    return Array.isArray(order)
      ? order
          .map(i => items[i])
          .filter(Boolean)
      : items;

  } catch (err) {
    console.warn(
      "⚠️ rerank fallback:",
      err.message
    );

    return items;
  }
}