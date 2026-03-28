// fund.stream.js - FINAL PRO (SMOOTH + STRUCTURED STREAM)

import fetch from "node-fetch";
import { runFundAgent } from "./fund.service.js";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;

// ================= SAFE WRITE =================
function writeSSE(res, data, type = "message") {
  if (res.writableEnded || res.destroyed) return true;

  const payload = JSON.stringify({
    type,
    data
  });

  return res.write(`data: ${payload}\n\n`);
}

// ================= 🔥 SPLIT CHUNK (FIX UX) =================
function splitChunks(text, size = 30) {
  const chunks = [];
  let i = 0;

  while (i < text.length) {
    chunks.push(text.slice(i, i + size));
    i += size;
  }

  return chunks;
}

// ================= BUILD PROMPT =================
function buildExplainPrompt(question, funds) {
  return `
Bạn là chuyên gia tư vấn quỹ nghiên cứu.

⚠️ KHÔNG được tạo thêm quỹ mới.
⚠️ CHỈ được nói về các quỹ sau:

${funds.map((f, i) => `
[${i + 1}] ${f.title} - ${f.agency}
`).join("\n")}

---

Câu hỏi:
${question}

---

Yêu cầu:
- Giải thích vì sao quỹ #1 phù hợp nhất
- So sánh nhanh các quỹ còn lại
- Viết 3-4 dòng
- KHÔNG bịa thêm thông tin
`;
}

// ================= CALL LLM =================
async function callLLM(prompt) {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3:8b",
        messages: [{ role: "user", content: prompt }],
        stream: false,
      }),
    });

    const json = await res.json();
    return json?.message?.content || "";
  } catch {
    return "";
  }
}

// ================= MAIN =================
export async function streamFund(req, res, question, model_id, topk = 5) {
  let isClosed = false;
  let keepAlive = null;

  try {
    // ================= SSE =================
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    res.flushHeaders?.();

    keepAlive = setInterval(() => {
      if (!isClosed && !res.writableEnded && !res.destroyed) {
        res.write(": ping\n\n");
      }
    }, 15000);

    req.once("close", () => {
      isClosed = true;
      clearInterval(keepAlive);
    });

    // ================= PROGRESS =================
    writeSSE(res, "🔍 Đang tìm quỹ...", "progress");

    const result = await runFundAgent(req, question, model_id, topk);

    if (!result.funds.length) {
      writeSSE(res, "❌ Không tìm thấy quỹ phù hợp", "error");
      writeSSE(res, "[DONE]", "done");
      return res.end();
    }

    writeSSE(res, "📊 Đã phân tích xong", "progress");

    // ================= STREAM RESULT =================
    writeSSE(res, "💰 Kết quả:\n", "header");

    const chunks = splitChunks(result.answer, 40);

    for (const chunk of chunks) {
      if (isClosed) break;

      writeSSE(res, chunk, "chunk");
      await new Promise(r => setTimeout(r, 10));
    }

    // ================= EXPLAIN =================
    writeSSE(res, "\n\n🤖 Phân tích thêm:\n", "header");

    let explain = "";

    try {
      const prompt = buildExplainPrompt(question, result.funds);

      explain = await Promise.race([
        callLLM(prompt),
        new Promise(resolve => setTimeout(() => resolve(""), 3000))
      ]);
    } catch {}

    if (explain) {
      const chunks = splitChunks(explain, 50);

      for (const chunk of chunks) {
        if (isClosed) break;

        writeSSE(res, chunk, "chunk");
        await new Promise(r => setTimeout(r, 15));
      }
    } else {
      writeSSE(res, "Không có phân tích thêm.", "chunk");
    }

    // ================= DONE =================
    writeSSE(res, "[DONE]", "done");
    res.end();

  } catch (err) {
    console.error("❌ stream error:", err.message);

    if (!res.writableEnded) {
      writeSSE(res, "❌ Lỗi hệ thống", "error");
      writeSSE(res, "[DONE]", "done");
      res.end();
    }
  } finally {
    clearInterval(keepAlive);
  }
}