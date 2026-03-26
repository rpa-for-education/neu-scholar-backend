import fetch from "node-fetch";
import { runAgent } from "./scholar.agent.js";
import { addToHistory } from "../../middlewares/session.js";
import { buildScholarPrompt } from "./scholar.prompt.js";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const TIMEOUT = 15000;

// ================= TIMEOUT =================
function fetchWithTimeout(url, options, ms = TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);

  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(id));
}

// ================= MAIN =================
export async function streamScholar(req, res, question, topk = 5) {
  let result = null;

  try {
    // ================= SSE HEADER =================
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    res.flushHeaders?.();

    // 🔥 detect disconnect
    let closed = false;
    req.on("close", () => {
      closed = true;
      console.warn("⚠️ client disconnected");
    });

    // ================= UX =================
    res.write(`data: 🔍 Đang tìm dữ liệu...\n\n`);

    // ================= RUN AGENT =================
    result = await runAgent(question, topk);

    if (closed) return;

    if (!result.conferences.length && !result.journals.length) {
      res.write(`data: ❌ Không có dữ liệu phù hợp\n\n`);
      return res.end();
    }

    res.write(`data: 📚 Đã tìm thấy dữ liệu, đang phân tích...\n\n`);

    // 👉 bỏ history cho nhanh
    const prompt = buildScholarPrompt(
      question,
      result.conferences,
      result.journals,
      []
    );

    // ================= STREAM =================
    const response = await fetchWithTimeout(
      `${OLLAMA_BASE}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3:8b",
          messages: [{ role: "user", content: prompt }],
          stream: true,
        }),
      },
      TIMEOUT
    );

    if (!response.body) throw new Error("No stream body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let finalText = "";

    while (!closed) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let lines = buffer.split("\n");
      buffer = lines.pop(); // giữ phần dang dở

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const json = JSON.parse(line);
          const token = json.message?.content;

          if (!token) continue;

          finalText += token;

          res.write(`data: ${token}\n\n`);
          res.flush?.();

        } catch {
          // skip parse error
        }
      }
    }

    // ================= SAVE =================
    try {
      if (finalText) {
        addToHistory(req, question, finalText);
      }
    } catch {}

    res.write(`data: [DONE]\n\n`);
    res.end();

  } catch (err) {
    console.error("❌ stream error:", err.message);

    // ================= FALLBACK =================
    res.write(`data: ⚠️ Trả kết quả nhanh...\n\n`);

    if (result) {
      const fallbackText = result.answer || "Có dữ liệu liên quan.";
      res.write(`data: ${fallbackText}\n\n`);
    } else {
      res.write(`data: ❌ Lỗi hệ thống\n\n`);
    }

    res.write(`data: [DONE]\n\n`);
    res.end();
  }
}