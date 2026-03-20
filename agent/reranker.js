// agent/reranker.js
import { callLLMJson } from "../llm.js";

export async function rerankAdvanced(query, items) {
  if (!items.length) return items;

  const prompt = `
You are an academic ranking expert.

User query:
"${query}"

Rank the items by:
1. relevance to query
2. academic quality
3. usefulness for publication

Return ONLY JSON array of indices.

Items:
${items.map((it, i) =>
  `[${i}] ${it.title || ""} | ${it.topics || it.areas || ""}`
).join("\n")}
`;

  try {
    const order = await callLLMJson(prompt);

    if (!Array.isArray(order)) return items;

    return order.map(i => items[i]).filter(Boolean);

  } catch (e) {
    console.log("⚠️ rerank fallback");
    return items;
  }
}