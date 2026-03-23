import { callLLM } from "../shared/llm.js";

// 👉 build prompt rerank
function buildRerankPrompt(question, items) {
  let text = `Bạn là AI chọn lọc học thuật.

Chọn ra 5 mục phù hợp nhất với câu hỏi.

Chỉ trả về danh sách index (không giải thích).
Format: 1,3,5,...

Câu hỏi: ${question}

Danh sách:
`;

  items.forEach((it, i) => {
    const title = it.name || it.title;
    const extra = it.topics || it.categories || "";

    text += `[${i}] ${title} | ${extra}\n`;
  });

  return text;
}

// 👉 parse output LLM
function parseIndexes(output, max) {
  if (!output) return [];

  return output
    .split(/[, \n]/)
    .map(x => parseInt(x))
    .filter(x => !isNaN(x) && x >= 0 && x < max);
}

// 👉 main rerank
export async function rerankWithLLM(items, question, topk = 5) {
  if (!items.length) return [];

  try {
    const prompt = buildRerankPrompt(question, items.slice(0, 10));

    const res = await callLLM(prompt);
    const text = res?.answer || "";

    const indexes = parseIndexes(text, items.length);

    if (!indexes.length) return items.slice(0, topk);

    return indexes.map(i => items[i]).slice(0, topk);

  } catch (err) {
    console.error("❌ Rerank error:", err.message);
    return items.slice(0, topk);
  }
}