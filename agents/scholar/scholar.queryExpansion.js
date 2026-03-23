import { callLLM } from "../shared/llm.js";

export async function expandQuery(question) {
  try {
    const prompt = `
Viết lại câu hỏi dưới 3 dạng khác nhau để tìm kiếm học thuật.
Ngắn gọn, không giải thích.

Câu hỏi: ${question}
    `;

    const res = await callLLM(prompt);
    const text = res?.answer || "";

    const queries = text
      .split("\n")
      .map(x => x.trim())
      .filter(x => x.length > 5);

    return [question, ...queries].slice(0, 3);

  } catch {
    return [question];
  }
}