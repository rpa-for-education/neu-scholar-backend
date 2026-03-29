import express from "express";
import { runScholarAgent } from "../../agents/scholar/scholar.service.js";
import { streamScholar } from "../../agents/scholar/scholar.stream.js";

const router = express.Router();

// ================= UTILS =================
function safeTopk(topk) {
  const n = Number(topk);
  return n && n > 0 ? Math.min(n, 5) : 5;
}

// 👉 FIX: normalize URL
function getConferenceUrl(c) {
  return c?.url || "";
}

function getJournalUrl(j) {
  return j?.scimago_link || j?.url || "";
}

// ================= CORE =================
async function handleAsk(req, res) {
  try {
    const {
      session_id,
      question,
      prompt,
      query,
      message,
      model_id = "qwen3-4b",
      topk
    } = req.body || {};

    const rawInput = question ?? prompt ?? query ?? message;

    const finalQuestion = typeof rawInput === "string"
      ? rawInput.trim()
      : "";

    if (!finalQuestion) {
      return res.status(400).json({
        status: "error",
        error: "Missing question"
      });
    }

    const result = await runScholarAgent(
      req,
      finalQuestion,
      model_id,
      topk
    );

    // ================= BUILD SOURCES =================
    const sources = [];

    // ===== CONFERENCE =====
    (result?.conferences || []).forEach((c, i) => {
      sources.push({
        id: `C${i + 1}`,
        type: "conference",
        title: c.name,
        url: getConferenceUrl(c), // ✅ đúng
        metadata: {
          year: c.year,
          country: c.country,
          deadline: c.deadline
        }
      });
    });

    // ===== JOURNAL (🔥 FIX QUAN TRỌNG) =====
    (result?.journals || []).forEach((j, i) => {
      sources.push({
        id: `J${i + 1}`,
        type: "journal",
        title: j.title,
        url: getJournalUrl(j), // 🔥 FIX Ở ĐÂY
        metadata: {
          publisher: j.publisher,
          quartile: j.sjr_best_quartile
        }
      });
    });

    // 🔥 DEBUG (có thể tắt)
    console.log("📦 SOURCES:", sources);

    return res.json({
      session_id: session_id ?? null,
      status: "success",

      // 🔥 LUÔN dùng output đã format
      content_markdown: result.answer,
      answer: result.answer,

      sources,

      meta: {
        response_time_ms: result.responseTimeMs,
        domain: result.domain,
      },
    });

  } catch (err) {
    console.error("❌ Scholar error:", err);

    return res.status(500).json({
      status: "error",
      error: err.message || "Internal error"
    });
  }
}

// ================= ROUTES =================
router.post("/", handleAsk);
router.post("/ask", handleAsk);

// ================= DATA API =================
router.get("/data", async (req, res) => {
  try {
    const { type, limit = 20, page = 1 } = req.query;

    const t = String(type || "").toLowerCase();

    if (!["conferences", "journals"].includes(t)) {
      return res.status(400).json({
        status: "error",
        error: "type must be 'conferences' or 'journals'"
      });
    }

    const finalLimit = Math.min(Number(limit) || 20, 100);
    const skip = (Number(page) - 1) * finalLimit;

    // 👉 IMPORT DB nếu chưa có ở đầu file
    const { getDb } = await import("../../db/mongo.js");
    const db = await getDb();

    const collectionName =
      t === "conferences" ? "conference" : "journal";

    const col = db.collection(collectionName);

    const [items, total] = await Promise.all([
      col.find({})
        .skip(skip)
        .limit(finalLimit)
        .toArray(),
      col.countDocuments({})
    ]);

    let data = [];

    if (t === "conferences") {
      data = items.map((c) => ({
        id: c._id,
        name: c.name,
        acronym: c.acronym,
        year: c.year,
        country: c.country,
        deadline: c.deadline,
        url: c.url || ""
      }));
    }

    if (t === "journals") {
      data = items.map((j) => ({
        id: j._id,
        title: j.title,
        publisher: j.publisher,
        quartile: j.sjr_best_quartile,
        sjr: j.sjr,
        h_index: j.h_index,
        url: j.scimago_link || j.url || ""
      }));
    }

    return res.json({
      status: "success",
      type: t,
      pagination: {
        total,
        page: Number(page),
        limit: finalLimit,
        total_pages: Math.ceil(total / finalLimit)
      },
      data
    });

  } catch (err) {
    console.error("❌ /data error:", err);

    return res.status(500).json({
      status: "error",
      error: err.message || "Internal error"
    });
  }
});

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