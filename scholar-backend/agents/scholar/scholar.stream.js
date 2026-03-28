// scholar.stream.js
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

  const promise = fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(id));

  return { promise, controller };
}

// ================= MAIN =================
export async function streamScholar(req, res, question, topk = 5) {
  let result = null;
  let controller = null;

  // 🔥 heartbeat
  let heartbeat = null;

  try {
    // ================= SSE HEADER =================
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    res.flushHeaders?.();

    let closed = false;

    req.on("close", () => {
      closed = true;
      console.warn("⚠️ client disconnected");

      // 🔥 cleanup toàn bộ
      if (heartbeat) clearInterval(heartbeat);
      if (controller) controller.abort();
    });

    // 🔥 heartbeat chống timeout
    heartbeat = setInterval(() => {
      if (!closed) res.write(`:\n\n`);
    }, 10000);

    // ================= UX =================
    res.write(`data: 🔍 Đang tìm dữ liệu...\n\n`);

    // ================= RUN AGENT =================
    result = await runAgent(question, topk);

    if (closed) return;

    if (!result.conferences.length && !result.journals.length) {
      res.write(`data: ❌ Không có dữ liệu phù hợp\n\n`);
      clearInterval(heartbeat);
      return res.end();
    }

    res.write(`data: 📚 Đã tìm thấy dữ liệu, đang phân tích...\n\n`);

    const prompt = buildScholarPrompt(
      question,
      result.conferences,
      result.journals,
      []
    );

    // ================= STREAM =================
    const { promise, controller: ctrl } = fetchWithTimeout(
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

    controller = ctrl;

    const response = await promise;

    if (!response.ok) {
      throw new Error(`LLM error: ${response.status}`);
    }

    if (!response.body) throw new Error("No stream body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let finalText = "";

    while (!closed) {
      const { done, value } = await reader.read();

      if (done || closed) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const json = JSON.parse(trimmed);
          const token = json.message?.content;

          if (!token) continue;

          finalText += token;

          res.write(`data: ${token}\n\n`);
          res.flush?.();

        } catch {
          // ignore partial JSON
        }
      }
    }

    clearInterval(heartbeat);

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

    if (heartbeat) clearInterval(heartbeat);

    // ================= 🔥 FALLBACK THÔNG MINH =================
    try {
      res.write(`data: ⚠️ Trả kết quả nhanh...\n\n`);

      if (result) {
        const fallbackText =
          result.answer ||
          "Có dữ liệu phù hợp với truy vấn.";

        res.write(`data: ${fallbackText}\n\n`);
      } else {
        res.write(`data: ❌ Lỗi hệ thống\n\n`);
      }

      res.write(`data: [DONE]\n\n`);
      res.end();
    } catch {}
  }
}