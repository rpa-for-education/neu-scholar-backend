// scholar.routes.js
import express from "express";
import { runScholarAgent } from "../../agents/scholar/scholar.service.js";
import { streamScholar } from "../../agents/scholar/scholar.stream.js";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const {
      question,
      prompt,
      model_id = "qwen3-8b",
      topk = 5
    } = req.body;

    // ✅ hỗ trợ cả 2
    const finalQuestion = question || prompt;

    if (!finalQuestion || !finalQuestion.trim()) {
      return res.status(400).json({
        error: "Missing or invalid question"
      });
    }

    const result = await runScholarAgent(
      req,
      finalQuestion,
      model_id,
      topk
    );

    res.json(result);

  } catch (err) {
    console.error("❌ Scholar error:", err);

    res.status(500).json({
      error: err.message
    });
  }
});

router.post("/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  await streamScholar(req, res, req.body.question);
});

export default router;