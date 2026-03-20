// app.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import fetch from "node-fetch";

import { callLLM, modelMap } from "./llm.js";
import { runAgent } from "./agent/agent.js";

const app = express();
const PORT = process.env.PORT || 8014;

const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "fitsecret",
    resave: false,
    saveUninitialized: true,
  })
);

// ================= MEMORY =================
const MAX_HISTORY = 5;

function getSessionHistory(req) {
  if (!req.session.history) {
    req.session.history = [];
  }
  return req.session.history;
}

function addToHistory(req, question, answer) {
  const history = getSessionHistory(req);

  history.push({ role: "user", content: question });
  history.push({ role: "assistant", content: answer });

  if (history.length > MAX_HISTORY * 2) {
    history.splice(0, history.length - MAX_HISTORY * 2);
  }
}

// ================= BUILD PROMPT =================
function buildPrompt(question, conferences = [], journals = [], history = []) {
  let context = `
Bạn là AI tư vấn học thuật (conference + journal).
Chỉ được dùng dữ liệu bên dưới. Không bịa.
`;

  if (history.length) {
    context += "\n=== LỊCH SỬ ===\n";
    history.forEach(h => {
      context += `${h.role === "user" ? "User" : "Assistant"}: ${h.content}\n`;
    });
  }

  if (conferences.length) {
    context += "\n=== CONFERENCES ===\n";
    conferences.forEach((c, i) => {
      context += `[C${i + 1}] ${c.name || c.title || ""} | ${c.country || ""} | ${c.deadline || ""}\n`;
    });
  }

  if (journals.length) {
    context += "\n=== JOURNALS ===\n";
    journals.forEach((j, i) => {
      context += `[J${i + 1}] ${j.title || ""} | ${j.publisher || ""} | ${j.quartile || ""}\n`;
    });
  }

  context += `\nCâu hỏi: ${question}\n`;

  return context;
}

// ================= CORE =================
async function runAgentFull(req, question, model_id, topk) {
  const history = getSessionHistory(req);

  const result = await runAgent(question, topk);

  if (!result.conferences.length && !result.journals.length) {
    return {
      answer: "Không tìm thấy dữ liệu phù hợp trong hệ thống.",
      conferences: [],
      journals: [],
      domain: "empty"
    };
  }

  const prompt = buildPrompt(
    question,
    result.conferences,
    result.journals,
    history
  );

  const llm = await callLLM(prompt, model_id);
  const answer = llm.answer || "";

  addToHistory(req, question, answer);

  return {
    answer,
    conferences: result.conferences,
    journals: result.journals,
    domain: result.domain || "general"
  };
}

// ================= API =================

// NORMAL
app.post("/api/agent", async (req, res) => {
  try {
    const { question, model_id = "qwen3-8b", topk = 5 } = req.body;

    if (!question) {
      return res.status(400).json({ error: "Missing question" });
    }

    const result = await runAgentFull(req, question, model_id, topk);

    res.json(result);

  } catch (err) {
    console.error("❌ /api/agent error:", err);
    res.status(500).json({ error: err.message });
  }
});

// STREAMING (SSE) — FIXED
app.post("/api/agent/stream", async (req, res) => {
  try {
    const { question, topk = 5 } = req.body;
    if (!question) return res.end();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const history = getSessionHistory(req);
    const result = await runAgent(question, topk);

    if (!result.conferences.length && !result.journals.length) {
      res.write(`data: Không có dữ liệu\n\n`);
      return res.end();
    }

    const prompt = buildPrompt(
      question,
      result.conferences,
      result.journals,
      history
    );

    const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3:8b",
        messages: [{ role: "user", content: prompt }],
        stream: true,
      }),
    });

    // 🔥 CHECK RESPONSE
    if (!response.ok || !response.body) {
      console.error("❌ Ollama stream failed:", response.status);
      res.write(`data: Lỗi kết nối Ollama\n\n`);
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let finalText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const json = JSON.parse(line);
          const token = json.message?.content || "";

          finalText += token;
          res.write(`data: ${token}\n\n`);
        } catch {}
      }
    }

    addToHistory(req, question, finalText);

    res.write(`data: [DONE]\n\n`);
    res.end();

  } catch (err) {
    console.error("❌ stream error:", err);
    res.end();
  }
});

// AI PORTAL
app.post("/ask", async (req, res) => {
  try {
    const { prompt } = req.body;

    const result = await runAgentFull(req, prompt, "qwen3-8b", 5);

    res.json({
      status: "success",
      content_markdown: result.answer,
      sources: [...result.journals, ...result.conferences]
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= METADATA =================
const MODEL_META = {
  "qwen3-8b": {
    name: "Qwen3 8B",
    description: "LLM tối ưu cho tư vấn học thuật"
  }
};

const METADATA_DATA = {
  name: "Hội thảo, Tạp chí",
  description:
    "Tìm kiếm, hỏi đáp, tổng hợp các cơ hội công bố các sản phẩm khoa học trên các Hội thảo, Tạp chí,... trong nước và quốc tế uy tín nhằm phục vụ hoạt động nghiên cứu khoa học của cán bộ, giảng viên, học viên,... của Đại học Kinh tế Quốc dân",
  version: "1.2.0",
  developer: "Nhóm thầy V Huy, V Minh, X Lâm",
  capabilities: ["search", "explain", "summarize"],
  sample_prompts: [
    "Hội thảo liên quan tới các công nghệ mới nổi như AI, Big Data, BlockChain, v.v...?",
    "Các hội thảo quốc tế được tổ chức tại Trung Quốc trong năm 2026?",
    "Tạp chí phù hợp với lĩnh vực Hệ thống thông tin quản lý?",
    "Danh sách các tạp chí phù hợp với lĩnh vực Kinh tế bền vững?",
  ],
  provided_data_types: [
    { type: "conferences", description: "Danh sách hội thảo trong nước và quốc tế mà NEU Research Agent đang lưu trữ" },
    { type: "journals", description: "Danh sách tạp chí trong nước và quốc tế mà NEU Research Agent đang lưu trữ" },
  ],
  contact: "kcntt@neu.edu.vn",
  status: "active",
};

app.get("/api/metadata", (req, res) => {
  res.json({
    ...METADATA_DATA,
    supported_models: Object.keys(modelMap),
    timestamp: new Date().toISOString()
  });
});

// ================= HEALTH =================
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ================= START =================
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});