// agents/fund/fund.rerank.js

import { callLLM } from "../shared/llm.js";

export async function rerankFunds(query, funds, model_id) {
  const prompt = `
Bạn là chuyên gia chọn quỹ nghiên cứu.

Query: ${query}

Danh sách quỹ:
${funds.map((f, i) => `
[${i+1}] ${f.title}
- Agency: ${f.agency}
- Summary: ${f.text?.slice(0, 200)}
`).join("\n")}

Hãy chọn TOP 3 quỹ phù hợp nhất.
Chỉ trả về index, ví dụ: 1,3,5
`;

  const res = await callLLM(prompt, model_id);

  const text = res.answer || "";

  const indexes = text.match(/\d+/g)?.map(n => Number(n) - 1) || [];

  return indexes
    .map(i => funds[i])
    .filter(Boolean);
}