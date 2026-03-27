// fund.rerank.js - Rerank kết quả quỹ nghiên cứu khoa học bằng LLM
import { callLLM } from "../shared/llm.js";

const MAX_INPUT = 8;
const DEFAULT_TOPK = 3;

// ================= PARSE =================
function parseIndexes(text, max) {
  if (!text) return [];

  const nums = text.match(/\d+/g);
  if (!nums) return [];

  const seen = new Set();

  return nums
    .map(n => Number(n) - 1)
    .filter(i => i >= 0 && i < max)
    .filter(i => {
      if (seen.has(i)) return false;
      seen.add(i);
      return true;
    });
}

// ================= BUILD PROMPT =================
function buildPrompt(query, funds) {
  return `
Bạn là chuyên gia chọn quỹ nghiên cứu.

Nhiệm vụ:
- Chọn ra ${DEFAULT_TOPK} quỹ PHÙ HỢP NHẤT với query
- Ưu tiên:
  + liên quan nội dung
  + funding cao
  + deadline hợp lý

⚠️ QUY TẮC:
- CHỈ trả về index
- KHÔNG giải thích
- KHÔNG viết thêm chữ
- Format bắt buộc: 1,3,5

Query:
${query}

Danh sách:
${funds.map((f, i) => `
[${i + 1}] ${f.title}
- ${f.agency || ""}
`).join("\n")}

OUTPUT:
`;
}

// ================= SAFE FALLBACK =================
function fallbackTop(input) {
  return input.slice(0, DEFAULT_TOPK);
}

// ================= MAIN =================
export async function rerankFunds(query, funds, model_id) {
  try {
    if (!funds || funds.length === 0) return [];

    const input = funds.slice(0, MAX_INPUT);

    const prompt = buildPrompt(query, input);

    let res;
    try {
      res = await callLLM(prompt, model_id);
    } catch (err) {
      console.warn("⚠️ rerank LLM fail:", err.message);
      return fallbackTop(input);
    }

    const text = (res?.answer || "").trim();

    const indexes = parseIndexes(text, input.length);

    // 🔥 nếu LLM trả ít hơn yêu cầu → bổ sung semantic
    if (!indexes.length) {
      console.warn("⚠️ rerank parse fail → fallback");
      return fallbackTop(input);
    }

    const selected = indexes
      .map(i => input[i])
      .filter(Boolean);

    // 🔥 đảm bảo đủ TOPK
    if (selected.length < DEFAULT_TOPK) {
      const remain = input.filter(f => !selected.includes(f));
      selected.push(...remain.slice(0, DEFAULT_TOPK - selected.length));
    }

    return selected.slice(0, DEFAULT_TOPK);

  } catch (err) {
    console.error("❌ rerankFunds error:", err.message);
    return funds.slice(0, DEFAULT_TOPK);
  }
}