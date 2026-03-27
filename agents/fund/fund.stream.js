// fund.stream.js - ENHANCED (STREAM MƯỢT + UX PRO)

import fetch from "node-fetch";
import { runFundAgent } from "./fund.service.js";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;

// ================= SAFE WRITE =================
function writeSSE(res, data) {
  if (res.writableEnded || res.destroyed) return true;

  const safe = String(data).replace(/\n/g, " ");
  return res.write(`data: ${safe}\n\n`);
}

// ================= SPLIT CHUNK (MƯỢT HƠN) =================
function splitText(text, size = 30) {
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

CÂU HỎI:
${question}

DANH SÁCH:
${funds.map((f, i) => `
[${i + 1}] ${f.title} - ${f.agency}
`).join("\n")}

Yêu cầu:
- Giải thích ngắn gọn vì sao quỹ #1 tốt nhất
- So sánh nhanh các quỹ còn lại
- Viết 3-4 dòng
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
    writeSSE(res, "🔍 Đang tìm quỹ...");
    await new Promise(r => setTimeout(r, 200));

    writeSSE(res, "📊 Đang phân tích & xếp hạng...");
    
    // ================= SERVICE =================
    const result = await runFundAgent(req, question, model_id, topk);

    if (!result.funds.length) {
      writeSSE(res, "❌ Không tìm thấy quỹ phù hợp");
      writeSSE(res, "[DONE]");
      return res.end();
    }

    await new Promise(r => setTimeout(r, 200));

    // ================= STREAM RESULT =================
    writeSSE(res, "💰 Kết quả:\n");

    const chunks = splitText(result.answer, 35);

    for (const chunk of chunks) {
      if (isClosed) break;

      const ok = writeSSE(res, chunk);

      if (ok === false) {
        await new Promise(resolve => {
          if (res.writableEnded || res.destroyed) return resolve();
          res.once("drain", resolve);
        });
      }

      await new Promise(r => setTimeout(r, 10));
    }

    // ================= LLM EXPLAIN (NON-BLOCKING STYLE) =================
    writeSSE(res, "\n\n🤖 Phân tích thêm:\n");

    let explain = "";

    try {
      const prompt = buildExplainPrompt(question, result.funds);

      // 🔥 timeout LLM (tránh treo)
      explain = await Promise.race([
        callLLM(prompt),
        new Promise(resolve => setTimeout(() => resolve(""), 3000))
      ]);
    } catch {}

    if (explain) {
      const explainChunks = splitText(explain, 40);

      for (const chunk of explainChunks) {
        if (isClosed) break;
        writeSSE(res, chunk);
        await new Promise(r => setTimeout(r, 15));
      }
    } else {
      writeSSE(res, "Không có phân tích thêm.");
    }

    // ================= DONE =================
    writeSSE(res, "[DONE]");
    res.end();

  } catch (err) {
    console.error("❌ stream error:", err.message);

    if (!res.writableEnded) {
      writeSSE(res, "❌ Lỗi hệ thống");
      writeSSE(res, "[DONE]");
      res.end();
    }
  } finally {
    clearInterval(keepAlive);
  }
}