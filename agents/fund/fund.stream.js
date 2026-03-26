import fetch from "node-fetch";
import { runFundAgent } from "./fund.service.js";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;

// ================= SAFE WRITE =================
function writeSSE(res, data) {
  if (res.writableEnded || res.destroyed) return true;

  const safe = String(data).replace(/\n/g, " ");
  return res.write(`data: ${safe}\n\n`);
}

// ================= BUILD LLM PROMPT =================
function buildExplainPrompt(question, funds) {
  return `
Bạn là chuyên gia tư vấn quỹ nghiên cứu.

⚠️ QUY TẮC:
- KHÔNG được tạo thêm quỹ mới
- CHỈ được phân tích các quỹ có sẵn
- KHÔNG được thay đổi thông tin

---

CÂU HỎI:
${question}

---

DANH SÁCH QUỸ:
${funds.map((f, i) => `
[${i + 1}] ${f.title}
- Agency: ${f.agency}
- Funding: ${f.amount}
`).join("\n")}

---

NHIỆM VỤ:
- Giải thích ngắn gọn:
  + Vì sao quỹ #1 là tốt nhất
  + So sánh nhanh các quỹ còn lại
- Không lặp lại thông tin đã có
- Viết ngắn gọn (3-5 dòng)
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

    writeSSE(res, "🔍 Đang tìm nguồn tài trợ...");

    // ================= SERVICE (CHUẨN DATA) =================
    const result = await runFundAgent(req, question, model_id, topk);

    if (!result.funds.length) {
      writeSSE(res, "❌ Không tìm thấy quỹ phù hợp");
      writeSSE(res, "[DONE]");
      return res.end();
    }

    // ================= STREAM DATA (KHÔNG QUA LLM) =================
    writeSSE(res, "💰 Kết quả:");

    const chunks = result.answer.split(" ");

    for (const chunk of chunks) {
      if (isClosed) break;

      const ok = writeSSE(res, chunk + " ");

      if (ok === false) {
        await new Promise(resolve => {
          if (res.writableEnded || res.destroyed) return resolve();
          res.once("drain", resolve);
        });
      }

      await new Promise(r => setTimeout(r, 5));
    }

    // ================= LLM EXPLAIN =================
    writeSSE(res, "\n\n🤖 Phân tích thêm:");

    const prompt = buildExplainPrompt(question, result.funds);
    const explain = await callLLM(prompt);

    if (explain) {
      const explainChunks = explain.split(" ");

      for (const chunk of explainChunks) {
        if (isClosed) break;
        writeSSE(res, chunk + " ");
        await new Promise(r => setTimeout(r, 5));
      }
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