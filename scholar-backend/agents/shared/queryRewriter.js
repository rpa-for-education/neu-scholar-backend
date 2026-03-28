// agent/queryRewriter.js
import { callLLMJson } from "./llm.js";

export async function rewriteQuery(question) {
  const prompt = `
Rewrite the user query into 3 optimized academic search queries.

Focus on:
- research field
- academic terminology
- conference / journal context

Question:
"${question}"

Return JSON:
{
  "queries": ["...", "...", "..."]
}
`;

  try {
    const data = await callLLMJson(prompt);

    if (Array.isArray(data.queries) && data.queries.length) {
      return data.queries;
    }

    return [question];
  } catch (e) {
    console.log("⚠️ rewrite fallback");
    return [question];
  }
}