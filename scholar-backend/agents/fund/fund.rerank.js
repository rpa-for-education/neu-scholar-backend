// fund.rerank.js - FINAL FIX (STABLE + INTENT-AWARE + SAFE)

import { callLLM } from "../shared/llm.js";

const MAX_INPUT = 8;
const DEFAULT_TOPK = 3;

// ================= PARSE (FIX CHẶT) =================
function parseIndexes(text, max) {
  if (!text) return [];

  // 🔥 chỉ lấy dòng đầu (tránh hallucination)
  const firstLine = text.split("\n")[0];

  const nums = firstLine.match(/\d+/g);
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

// ================= BUILD PROMPT (FIX INTENT) =================
function buildPrompt(query, funds) {
  return `
Bạn là chuyên gia chọn quỹ nghiên cứu.

🎯 Mục tiêu:
Chọn ${DEFAULT_TOPK} quỹ PHÙ HỢP NHẤT với query.

⚠️ QUAN TRỌNG:
- Ưu tiên KHỚP NỘI DUNG query (QUAN TRỌNG NHẤT)
- Nếu query chứa từ khóa cụ thể (ví dụ: nafosted, vietnam):
  → PHẢI ưu tiên quỹ có chứa từ khóa đó
- KHÔNG chọn quỹ không liên quan chỉ vì funding cao

---

Query:
${query}

---

Danh sách:
${funds.map((f, i) => `
[${i + 1}] ${f.title}
- ${f.agency || ""}
`).join("\n")}

---

⚠️ OUTPUT:
- CHỈ trả về index
- KHÔNG giải thích
- Format: 1,3,5
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

    // 🔥 nếu parse fail → KHÔNG override mạnh
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

    // 🔥 FIX QUAN TRỌNG: chỉ override nhẹ (không phá ranking gốc)
    return selected.slice(0, DEFAULT_TOPK);

  } catch (err) {
    console.error("❌ rerankFunds error:", err.message);
    return funds.slice(0, DEFAULT_TOPK);
  }
}