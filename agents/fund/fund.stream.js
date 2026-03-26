import fetch from "node-fetch";
import { searchFund } from "./fund.search.js";
import { buildFundPrompt } from "./fund.prompt.js";
import { getSessionHistory, addToHistory } from "../../middlewares/session.js";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const TIMEOUT = 20000;

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
export async function streamFund(req, res, question, topk = 5) {
  try {
    // ================= SSE HEADER =================
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    res.flushHeaders?.();

    // ================= UX =================
    res.write(`data: 🔍 Đang tìm nguồn tài trợ...\n\n`);

    const history = getSessionHistory(req);

    const results = await searchFund(question, topk);

    if (!results.length) {
      res.write(`data: ❌ Không có dữ liệu phù hợp\n\n`);
      return res.end();
    }

    res.write(`data: 💰 Đã tìm thấy ${results.length} nguồn, đang phân tích...\n\n`);

    const funds = results.map(r => r.payload);

    const prompt = buildFundPrompt(question, funds, history);

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

    if (!response.body) {
      throw new Error("No stream body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let finalText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);

      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;

        try {
          const json = JSON.parse(line);
          const token = json.message?.content || "";

          if (!token) continue;

          finalText += token;

          res.write(`data: ${token}\n\n`);

        } catch {}
      }
    }

    // ================= SAVE HISTORY =================
    try {
      addToHistory(req, question, finalText);
    } catch {
      console.warn("⚠️ history fail");
    }

    res.write(`data: [DONE]\n\n`);
    res.end();

  } catch (err) {
    console.error("❌ fund stream error:", err.message);

    // ================= FALLBACK =================
    res.write(`data: ⚠️ Hệ thống đang bận, trả kết quả nhanh...\n\n`);

    try {
      const results = await searchFund(question, topk);

      const fallback = results
        .slice(0, 3)
        .map(r => r.payload?.title)
        .join(", ");

      res.write(`data: ${fallback || "Có dữ liệu liên quan"}\n\n`);
    } catch {
      res.write(`data: ❌ Lỗi hệ thống\n\n`);
    }

    res.write(`data: [DONE]\n\n`);
    res.end();
  }
}