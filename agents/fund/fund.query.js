// agents/fund/fund.query.js

import { callLLM } from "../shared/llm.js";

const CACHE = new Map();
const TTL = 1000 * 60 * 10;

function getCache(key) {
  const item = CACHE.get(key);
  if (!item) return null;

  if (Date.now() - item.time > TTL) {
    CACHE.delete(key);
    return null;
  }

  return item.value;
}

function setCache(key, value) {
  CACHE.set(key, { time: Date.now(), value });
}

// ================= REWRITE =================
export async function rewriteQuery(question, model_id) {
  const key = "rewrite:" + question;
  const cached = getCache(key);
  if (cached) return cached;

  try {
    const prompt = `
Rewrite the query for research funding search.

- Giữ nguyên tiếng Việt
- Mở rộng thêm từ khóa tiếng Anh nếu cần
- Không làm mất ý nghĩa gốc

Query: ${question}
`;

    const res = await callLLM(prompt, model_id);

    const rewritten = res?.answer?.trim() || question;

    setCache(key, rewritten);

    return rewritten;
  } catch {
    return question;
  }
}

// ================= INTENT =================
export async function detectIntent(question, model_id) {
  const key = "intent:" + question;
  const cached = getCache(key);
  if (cached) return cached;

  try {
    const prompt = `
Trích xuất intent từ câu hỏi.

Trả về JSON:
{
 "year": number|null,
 "domain": string[],
 "priority": string
}

Query: ${question}
`;

    const res = await callLLM(prompt, model_id);

    let json;
    try {
      json = JSON.parse(res.answer);
    } catch {
      json = {};
    }

    const intent = {
      year: json.year || null,
      domain: json.domain || [],
      priority: json.priority || "relevance"
    };

    setCache(key, intent);

    return intent;

  } catch {
    return { year: null, domain: [], priority: "relevance" };
  }
}