// fund.stream.js
import fetch from "node-fetch";
import { runFundSearch } from "./fund.agent.js";
import { buildFundPrompt } from "./fund.prompt.js";
import { getSessionHistory, addToHistory } from "../../middlewares/session.js";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const MAX_CONTEXT = 6;
const FETCH_TIMEOUT = 20000; // 🔥 chống treo LLM

// ================= SAFE WRITE =================
function writeSSE(res, data) {
  if (res.writableEnded || res.destroyed) return true;

  const safe = String(data).replace(/\n/g, " ");
  return res.write(`data: ${safe}\n\n`);
}

// ================= PARSE LINE =================
function parseLine(line) {
  try {
    line = line.trim();
    if (!line) return null;

    if (line.startsWith("data:")) {
      line = line.replace(/^data:\s*/, "");
    }

    if (line === "[DONE]") return { done: true };

    return JSON.parse(line);
  } catch {
    return null;
  }
}

// ================= FETCH TIMEOUT =================
function fetchWithTimeout(url, options, controller) {
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  return fetch(url, {
    ...options,
    signal: controller.signal
  }).finally(() => clearTimeout(id));
}

// ================= MAIN =================
export async function streamFund(req, res, question, model_id, topk = 5) {
  let isClosed = false;
  let keepAlive = null;
  let reader = null;

  const controller = new AbortController();

  try {
    // ================= SSE HEADER =================
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    res.flushHeaders?.();

    // 🔥 keep-alive
    keepAlive = setInterval(() => {
      if (!isClosed && !res.writableEnded && !res.destroyed) {
        res.write(": ping\n\n");
      }
    }, 15000);

    // 🔥 disconnect
    req.once("close", () => {
      isClosed = true;
      controller.abort();
      try { reader?.cancel(); } catch {}
      clearInterval(keepAlive);
      console.log("❌ Client disconnected");
    });

    writeSSE(res, "🔍 Đang tìm nguồn tài trợ...");

    const history = getSessionHistory(req);

    // ================= SEARCH =================
    const results = await runFundSearch(question, model_id, topk);

    if (!results.length) {
      writeSSE(res, "❌ Không có dữ liệu phù hợp");
      clearInterval(keepAlive);
      if (!res.writableEnded) res.end();
      return;
    }

    writeSSE(res, `💰 Đã tìm thấy ${results.length} nguồn, đang phân tích...`);

    const funds = results.slice(0, MAX_CONTEXT).map(r => r.payload);
    const prompt = buildFundPrompt(question, funds, history);

    // ================= FETCH =================
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
      controller
    );

    if (!response.body) throw new Error("No stream body");

    reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let finalText = "";

    // ================= STREAM =================
    while (!isClosed) {
      let result;

      try {
        result = await reader.read();
      } catch {
        break; // 🔥 abort safe
      }

      const { done, value } = result;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 🔥 chống buffer phình to
      if (buffer.length > 10000) {
        buffer = buffer.slice(-5000);
      }

      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;

        const json = parseLine(line);
        if (!json || json.done) continue;

        const token = json?.message?.content;
        if (!token) continue;

        finalText += token;

        if (!isClosed) {
          const ok = writeSSE(res, token);

          // 🔥 backpressure safe
          if (ok === false) {
            await new Promise(resolve => {
              if (res.writableEnded || res.destroyed) return resolve();
              res.once("drain", resolve);
            });
          }
        }
      }
    }

    // 🔥 flush cuối
    try {
      buffer += decoder.decode();
    } catch {}

    if (buffer && !isClosed) {
      const json = parseLine(buffer);
      const token = json?.message?.content;

      if (token) {
        finalText += token;
        writeSSE(res, token);
      }
    }

    // ================= SAVE =================
    if (!isClosed && !res.writableEnded && !res.destroyed) {
      try {
        addToHistory(req, question, finalText);
      } catch {
        console.warn("⚠️ history fail");
      }

      writeSSE(res, "[DONE]");
      res.end();
    }

  } catch (err) {
    console.error("❌ fund stream error:", err.message);

    if (isClosed || res.writableEnded || res.destroyed) return;

    writeSSE(res, "⚠️ Hệ thống đang bận, trả kết quả nhanh...");

    try {
      const results = await runFundSearch(question, model_id, topk);

      const fallback = results
        .slice(0, 3)
        .map(r => r.payload?.title)
        .join(", ");

      writeSSE(res, fallback || "Có dữ liệu liên quan");
    } catch {
      writeSSE(res, "❌ Lỗi hệ thống");
    }

    writeSSE(res, "[DONE]");
    res.end();
  } finally {
    try { reader?.cancel(); } catch {}
    clearInterval(keepAlive);
  }
}