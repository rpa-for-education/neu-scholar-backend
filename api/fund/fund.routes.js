// fund.routes.js
import express from "express";
import { runFundAgent } from "../../agents/fund/fund.service.js";
import { streamFund } from "../../agents/fund/fund.stream.js";

const router = express.Router();

// ================= UTILS =================
function safeTopk(topk) {
  const n = Number(topk);
  return n && n > 0 ? n : 5;
}

// ================= NORMAL API =================
router.post("/", async (req, res) => {
  try {
    const {
      question,
      prompt,
      model_id = "qwen3-8b",
      topk
    } = req.body;

    // 🔥 unify input
    const finalQuestion = (question || prompt || "").trim();

    if (!finalQuestion) {
      return res.status(400).json({
        error: "Missing question"
      });
    }

    // 🔥 fix null / string / undefined topk
    const finalTopk = safeTopk(topk);

    const result = await runFundAgent(
      req,
      finalQuestion,
      model_id,
      finalTopk
    );

    res.json(result);

  } catch (err) {
    console.error("❌ Fund error:", err);

    res.status(500).json({
      error: err.message || "Internal server error"
    });
  }
});

// ================= STREAM API =================
router.post("/stream", async (req, res) => {
  try {
    const { question, prompt, topk } = req.body;

    const finalQuestion = (question || prompt || "").trim();

    if (!finalQuestion) {
      res.write(`data: Missing question\n\n`);
      return res.end();
    }

    const finalTopk = safeTopk(topk);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    await streamFund(req, res, finalQuestion, finalTopk);

  } catch (err) {
    console.error("❌ Stream Fund error:", err);

    res.write(`data: Error: ${err.message}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
  }
});

export default router;