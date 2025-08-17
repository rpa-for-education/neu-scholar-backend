// llm.js
import axios from "axios";
import { pipeline } from "@xenova/transformers";

// ===== Qwen =====
async function callQwen(prompt, model = process.env.QWEN_MODEL) {
  try {
    const baseUrl = process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
    const res = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.QWEN_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return res.data.choices?.[0]?.message?.content || "";
  } catch (err) {
    throw new Error(`Qwen error: ${err.response?.data?.message || err.message}`);
  }
}

// ===== OpenAI =====
async function callOpenAI(prompt, model = process.env.OPENAI_MODEL) {
  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return res.data.choices?.[0]?.message?.content || "";
  } catch (err) {
    throw new Error(`OpenAI error: ${err.response?.data?.error?.message || err.message}`);
  }
}

// ===== Gemini =====
async function callGemini(prompt, model = process.env.GEMINI_MODEL) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const res = await axios.post(
      url,
      { contents: [{ parts: [{ text: prompt }] }] },
      { headers: { "Content-Type": "application/json" } }
    );
    return res.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (err) {
    throw new Error(`Gemini error: ${err.response?.data?.error?.message || err.message}`);
  }
}

// ===== Local =====
let _localPipeline;
async function callLocal(prompt, model = process.env.LOCAL_MODEL || "Xenova/llama-2-7b-chat") {
  try {
    if (!_localPipeline) {
      console.log(`⏳ Loading local model ${model}...`);
      _localPipeline = await pipeline("text-generation", model);
      console.log(`✅ Local model ready: ${model}`);
    }
    const out = await _localPipeline(prompt, { max_new_tokens: 200 });
    return out[0]?.generated_text || "";
  } catch (err) {
    throw new Error(`Local error: ${err.message}`);
  }
}

// ===== Export Map =====
export const llmMap = {
  qwen: callQwen,
  openai: callOpenAI,
  gemini: callGemini,
  local: callLocal,
};
