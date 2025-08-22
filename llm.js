// llm.js
import axios from "axios";

// ==== Map model_id → provider + model ====
const modelMap = {
  // OpenAI
  "gpt-5": { provider: "openai", model: "gpt-5" },
  "gpt-5-mini": { provider: "openai", model: "gpt-5-mini" },
  "gpt-4.1": { provider: "openai", model: "gpt-4.1" },
  "gpt-4.1-mini": { provider: "openai", model: "gpt-4.1-mini" },

  // Gemini
  "gemini-2.5-pro": { provider: "gemini", model: "gemini-2.5-pro" },
  "gemini-2.5-flash": { provider: "gemini", model: "gemini-2.5-flash" },
  "gemini-2.5-flash-lite": { provider: "gemini", model: "gemini-2.5-flash-lite" },

  // Qwen
  "qwen-max": { provider: "qwen", model: "qwen-max" },
  "qwen-plus": { provider: "qwen", model: "qwen-plus" },
  "qwen-flash": { provider: "qwen", model: "qwen-flash" },
};

// ===== Qwen =====
async function callQwen(prompt, model) {
  const baseUrl = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

  const res = await axios.post(
    `${baseUrl}/chat/completions`,
    {
      model,
      messages: [{ role: "user", content: prompt }],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.QWEN_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  return res.data.choices?.[0]?.message?.content || "";
}

// ===== OpenAI =====
async function callOpenAI(prompt, model) {
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model,
      messages: [{ role: "user", content: prompt }],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  return res.data.choices?.[0]?.message?.content || "";
}

// ===== Gemini =====
async function callGemini(prompt, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const res = await axios.post(
    url,
    {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 20000,
    }
  );

  return res.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ===== Hàm gọi LLM chung =====
export async function callLLM(prompt, model_id = "qwen-max") {
  const info = modelMap[model_id];
  if (!info) {
    return {
      provider: null,
      model: model_id,
      answer: `❌ Model_id '${model_id}' không được hỗ trợ`,
    };
  }

  console.log(`⚡ callLLM: provider=${info.provider}, model=${info.model}`);

  try {
    let answer = "";
    switch (info.provider) {
      case "qwen":
        answer = await callQwen(prompt, info.model);
        break;
      case "openai":
        answer = await callOpenAI(prompt, info.model);
        break;
      case "gemini":
        answer = await callGemini(prompt, info.model);
        break;
      default:
        answer = `❌ Provider '${info.provider}' không hỗ trợ`;
    }

    return {
      provider: info.provider,
      model: info.model,
      answer,
    };
  } catch (err) {
    console.error("❌ LLM error:", err.response?.data || err.message);
    return {
      provider: info.provider,
      model: info.model,
      answer: `❌ Lỗi gọi ${info.provider}: ${err.message}`,
    };
  }
}
