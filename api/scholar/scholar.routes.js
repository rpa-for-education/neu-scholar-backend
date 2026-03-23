import express from "express";
import { runScholarAgent } from "../../agents/scholar/scholar.service.js";
import { streamScholar } from "../../agents/scholar/scholar.stream.js";

const router = express.Router();

// ================= UTILS =================
function safeTopk(topk) {
  const n = Number(topk);
  return n && n > 0 ? Math.min(n, 5) : 5;
}

// ================= CORE =================
async function handleAsk(req, res) {
  try {
    const {
      question,
      prompt,
      query,
      message,
      model_id = "qwen3-8b",
      topk
    } = req.body || {};

    const finalQuestion = (
      question ||
      prompt ||
      query ||
      message ||
      ""
    ).trim();

    if (!finalQuestion) {
      return res.status(400).json({
        error: "Missing question"
      });
    }

    const finalTopk = safeTopk(topk);

    // 🔥 QUAN TRỌNG: dùng pipeline cũ (xịn)
    const result = await runScholarAgent(
      req,
      finalQuestion,
      model_id,
      finalTopk
    );

    return res.json(result);

  } catch (err) {
    console.error("❌ Scholar error:", err);

    return res.status(200).json({
      success: false,
      error: err.message || "Internal error",
      data: []
    });
  }
}

// ================= ROUTES =================
router.post("/", handleAsk);
router.post("/ask", handleAsk);

// ================= STREAM =================
router.post("/stream", async (req, res) => {
  try {
    const { question, prompt, query, message, topk } = req.body || {};

    const finalQuestion = (
      question ||
      prompt ||
      query ||
      message ||
      ""
    ).trim();

    if (!finalQuestion) {
      res.write(`data: Missing question\n\n`);
      return res.end();
    }

    const finalTopk = safeTopk(topk);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    await streamScholar(req, res, finalQuestion, finalTopk);

  } catch (err) {
    console.error("❌ Stream Scholar error:", err);

    res.write(`data: Error: ${err.message}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
  }
});

export default router;