// llm.js
import axios from "axios";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";

// ===== MODEL MAP =====
export const modelMap = {
  "qwen3-8b": { provider: "ollama", model: "qwen3:8b" },
};

const DEFAULT_MODEL_ID = "qwen3-8b";

// ================= LOW LEVEL CALL =================
async function callOllamaRaw(messages, model) {
  const base = OLLAMA_BASE.replace(/\/$/, "");

  const res = await axios.post(
    `${base}/api/chat`,
    {
      model: model || DEFAULT_MODEL,
      messages,
      stream: false,
      options: {
        temperature: 0.2,   // 🔥 ổn định reasoning
      },
    },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 120000,
    }
  );

  return res.data?.message?.content || "";
}

// ================= SAFE JSON PARSE =================
function safeJSONParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    // 🔥 fallback: extract JSON block
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
  const model = info?.model || DEFAULT_MODEL;

  try {
    const answer = await callOllamaRaw(
      [{ role: "user", content: prompt }],
      model
    );

    return {
      provider: "ollama",
      model_id: model_id || DEFAULT_MODEL_ID,
      model,
      answer: answer || "",
    };
  } catch (err) {
    console.error("❌ LLM error:", err.message);
    return {
      provider: "ollama",
      model_id: model_id || DEFAULT_MODEL_ID,
      model,
      answer: "",
      error: err.message,
    };
  }
}

// ================= JSON MODE (QUAN TRỌNG) =================
export async function callLLMJson(prompt, model_id = DEFAULT_MODEL_ID) {
  const strictPrompt = `
You MUST return valid JSON only.
No explanation.

${prompt}
`;

  const res = await callLLM(strictPrompt, model_id);
  const parsed = safeJSONParse(res.answer);

  if (!parsed) {
    throw new Error("LLM JSON parse failed");
  }

  return parsed;
}

// ================= QUERY REWRITE =================
export async function rewriteQueryLLM(question) {
  const prompt = `
Rewrite the query into 3 optimized academic search queries.

Question:
"${question}"

Return JSON:
{
  "queries": ["...", "...", "..."]
}
`;

  try {
    const data = await callLLMJson(prompt);
    return data.queries || [question];
  } catch {
    return [question];
  }
}

// ================= RERANK =================
export async function rerankLLM(query, items) {
  if (!items.length) return items;

  const prompt = `
You are an academic ranking system.

Query:
"${query}"

Rank the items by relevance.

Return JSON array of indices.

Items:
${items.map((it, i) =>
  `[${i}] ${it.title} | ${it.topics || it.areas || ""}`
).join("\n")}
`;

  try {
    const order = await callLLMJson(prompt);

    return order.map(i => items[i]).filter(Boolean);
  } catch {
    return items;
  }
}