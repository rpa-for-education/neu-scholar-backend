// llm.js
import axios from 'axios';
import OpenAI from 'openai';

/**
 * Lấy dữ liệu hội thảo
 */
async function getConferenceData(query) {
  try {
    const res = await axios.get(`${process.env.API_CONFERENCE_URL}?q=${encodeURIComponent(query)}`);
    return res.data || [];
  } catch (error) {
    console.error('Conference API error:', error.message);
    return [];
  }
}

/**
 * Lấy dữ liệu tạp chí
 */
async function getJournalData(query) {
  try {
    const res = await axios.get(`${process.env.API_JOURNAL_URL}?q=${encodeURIComponent(query)}`);
    return res.data || [];
  } catch (error) {
    console.error('Journal API error:', error.message);
    return [];
  }
}

/**
 * Gọi model Gemini từ Google Generative Language API
 */
export async function callGemini(prompt) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY in environment');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  const response = await axios.post(url, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }]
  });

  return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Gọi model Qwen từ Alibaba Cloud (OpenAI-compatible API)
 */
export async function callQwen(prompt) {
  const QWEN_API_KEY = process.env.QWEN_API_KEY;
  if (!QWEN_API_KEY) throw new Error('Missing QWEN_API_KEY in environment');

  const client = new OpenAI({
    apiKey: QWEN_API_KEY,
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
  });

  const completion = await client.chat.completions.create({
    model: 'qwen-max',
    messages: [{ role: 'user', content: prompt }]
  });

  return completion.choices[0]?.message?.content || '';
}

/**
 * Agent tổng hợp: Gọi API Conference + Journal, sau đó gửi prompt cho model
 * @param {string} userPrompt - Nội dung người dùng hỏi
 * @param {'qwen'|'gemini'} provider - Model muốn dùng
 */
export async function runAgent(userPrompt, provider = 'qwen') {
  // Gọi song song 2 API dữ liệu
  const [conference, journal] = await Promise.all([
    getConferenceData(userPrompt),
    getJournalData(userPrompt)
  ]);

  // Chuẩn bị prompt
  const fullPrompt = `
Người dùng hỏi: ${userPrompt}

--- Dữ liệu hội thảo tìm được ---
${JSON.stringify(conference, null, 2)}

--- Dữ liệu tạp chí tìm được ---
${JSON.stringify(journal, null, 2)}

Hãy trả lời dựa trên dữ liệu trên. Nếu dữ liệu trống, hãy gợi ý cách tìm kiếm khác.
  `;

  let aiAnswer = '';
  if (provider === 'gemini') {
    aiAnswer = await callGemini(fullPrompt);
  } else {
    aiAnswer = await callQwen(fullPrompt);
  }

  return {
    provider,
    answer: aiAnswer,
    retrieved: {
      conference: conference || [],
      journal: journal || []
    }
  };
}
