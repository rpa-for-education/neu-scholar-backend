// agents/fund/fund.rerank.js

import { callLLM } from "../shared/llm.js";

const MAX_INPUT = 8;     // 🔥 chỉ gửi top 8
const DEFAULT_TOPK = 3;

// ================= PARSE =================
function parseIndexes(text, max) {
  if (!text) return [];

  return text
    .match(/\d+/g)
    ?.map(n => Number(n) - 1)
    .filter(i => i >= 0 && i < max) || [];
}

// ================= BUILD PROMPT =================
function buildPrompt(query, funds) {
  return `
Bạn là chuyên gia chọn quỹ nghiên cứu.

Chọn ra ${DEFAULT_TOPK} quỹ phù hợp nhất.

Chỉ trả về index, ví dụ: 1,3,5

Query: ${query}

Danh sách:
${funds.map((f, i) => `
[${i + 1}] ${f.title}
- ${f.agency || ""}
`).join("\n")}
`;
}

// ================= MAIN =================
export async function rerankFunds(query, funds, model_id) {
  try {
    if (!funds || funds.length === 0) return [];

    // 🔥 LIMIT INPUT → tăng tốc cực mạnh
    const input = funds.slice(0, MAX_INPUT);

    const prompt = buildPrompt(query, input);

    let res;
    try {
      res = await callLLM(prompt, model_id);
    } catch (err) {
      console.warn("⚠️ rerank LLM fail:", err.message);
      return input.slice(0, DEFAULT_TOPK); // fallback
    }

    const text = res?.answer || "";

    const indexes = parseIndexes(text, input.length);

    // 🔥 fallback nếu LLM trả bậy
    if (!indexes.length) {
      console.warn("⚠️ rerank parse fail → fallback");
      return input.slice(0, DEFAULT_TOPK);
    }

    return indexes
      .map(i => input[i])
      .filter(Boolean)
      .slice(0, DEFAULT_TOPK);

  } catch (err) {
    console.error("❌ rerankFunds error:", err.message);

    // 🔥 fallback cứng
    return funds.slice(0, DEFAULT_TOPK);
  }
}