// api/scholar/scholar.routes.js

import express from "express";

import {
  runScholarAgent
} from "../../agents/scholar/scholar.service.js";

import {
  streamScholar
} from "../../agents/scholar/scholar.stream.js";

const router = express.Router();


// ================= UTILS =================

function safeTopk(topk) {
  const n = Number(topk);

  return n && n > 0
    ? Math.min(n, 5)
    : 5;
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

      // LLM mới
      model_id = "qwen2.5-14b",

      topk,
      context = {}
    } = req.body || {};


    // ================= QUESTION =================

    const rawInput =
      question ??
      prompt ??
      query ??
      message;

    const finalQuestion =
      typeof rawInput === "string"
        ? rawInput.trim()
        : "";

    if (!finalQuestion) {
      return res.status(400).json({
        status: "error",
        error: "Missing question"
      });
    }


    // ================= TOP K =================

    const finalTopk =
      safeTopk(topk);


    // ================= MEMORY FROM PORTAL =================

    const history =
      Array.isArray(context?.history)
        ? context.history
            .filter(
              h =>
                h &&
                ["user", "assistant"].includes(h.role) &&
                typeof h.content === "string" &&
                h.content.trim()
            )
            .slice(-10)
        : [];


    // ================= DEBUG =================

    console.log(
      "\n========== SCHOLAR REQUEST =========="
    );

    console.log(
      "🆔 SESSION:",
      session_id
    );

    console.log(
      "❓ QUESTION:",
      finalQuestion
    );

    console.log(
      "🤖 MODEL:",
      model_id
    );

    console.log(
      "🔢 TOPK:",
      finalTopk
    );

    console.log(
      "🧠 MEMORY ITEMS:",
      history.length
    );

    console.log(
      "👤 USER:",
      context?.user_profile?.full_name ||
      "(none)"
    );

    console.log(
      "📌 PROJECT:",
      context?.project_info?.name ||
      context?.project ||
      "(none)"
    );

    console.log(
      "📄 DOCUMENTS:",
      Array.isArray(
        context?.extra_data?.document
      )
        ? context.extra_data.document.length
        : 0
    );

    console.log(
      "=====================================\n"
    );


    // ================= RUN SCHOLAR AGENT =================

    const result =
      await runScholarAgent(
        req,
        finalQuestion,
        model_id,
        finalTopk,
        history
      );


    // ================= GREETING =================

    const fullName =
      context
        ?.user_profile
        ?.full_name
        ?.trim() || "";

    const isFirstTurn =
      history.length === 0;

    let finalAnswer =
      result?.answer || "";


    // Greeting được backend quản lý deterministic.
    // Chỉ chào ở lượt đầu.
    if (
      isFirstTurn &&
      fullName &&
      finalAnswer
    ) {
      const normalizedAnswer =
        finalAnswer
          .trim()
          .toLowerCase();

      // Tránh chào hai lần nếu LLM đã tự chào
      if (
        !normalizedAnswer.startsWith(
          "xin chào"
        )
      ) {
        finalAnswer =
          `Xin chào ${fullName},\n\n${finalAnswer}`;
      }
    }


    console.log(
      "👤 FULL NAME:",
      fullName || "(empty)"
    );

    console.log(
      "🆕 FIRST TURN:",
      isFirstTurn
    );


    // ================= RESPONSE =================

    return res.json({
      session_id:
        session_id ?? null,

      status:
        "success",

      content_markdown:
        finalAnswer,

      answer:
        finalAnswer,

      // Dùng sources đã được service build.
      // Không build lại lần thứ hai.
      sources:
        result?.sources || [],

      meta: {
        response_time_ms:
          result?.responseTimeMs,

        domain:
          result?.domain,

        model_id:
          result?.model?.model_id ||
          model_id,

        model:
          result?.model?.model ||
          null,

        llm_latency_ms:
          result?.model?.latency ??
          null
      }
    });

  } catch (err) {

    console.error(
      "❌ Scholar error:",
      err
    );

    return res.status(500).json({
      status: "error",
      error:
        err.message ||
        "Internal error"
    });
  }
}


// ================= ROUTES =================

router.post("/", handleAsk);

router.post("/ask", handleAsk);


// ================= DATA API =================

router.get("/data", async (req, res) => {
  try {
    const {
      type,
      limit = 20,
      page = 1
    } = req.query;

    const t =
      String(type || "")
        .toLowerCase();

    if (
      ![
        "conferences",
        "journals"
      ].includes(t)
    ) {
      return res
        .status(400)
        .json({
          status: "error",
          error:
            "type must be 'conferences' or 'journals'"
        });
    }

    const finalLimit =
      Math.min(
        Number(limit) || 20,
        100
      );

    const skip =
      (Number(page) - 1) *
      finalLimit;


    const {
      getDb
    } = await import(
      "../../db/mongo.js"
    );

    const db =
      await getDb();


    const collectionName =
      t === "conferences"
        ? "conference"
        : "journal";

    const col =
      db.collection(
        collectionName
      );


    const [
      items,
      total
    ] = await Promise.all([
      col
        .find({})
        .skip(skip)
        .limit(finalLimit)
        .toArray(),

      col.countDocuments({})
    ]);


    let data = [];


    // ================= CONFERENCES =================

    if (
      t === "conferences"
    ) {
      data =
        items.map(c => ({
          id:
            c._id,

          name:
            c.name,

          acronym:
            c.acronym,

          year:
            c.year,

          country:
            c.country,

          deadline:
            c.deadline,

          url:
            c.url || ""
        }));
    }


    // ================= JOURNALS =================

    if (
      t === "journals"
    ) {
      data =
        items.map(j => ({
          id:
            j._id,

          title:
            j.title,

          publisher:
            j.publisher,

          quartile:
            j.sjr_best_quartile,

          sjr:
            j.sjr,

          h_index:
            j.h_index,

          url:
            j.scimago_link ||
            j.url ||
            ""
        }));
    }


    return res.json({
      status:
        "success",

      type:
        t,

      pagination: {
        total,

        page:
          Number(page),

        limit:
          finalLimit,

        total_pages:
          Math.ceil(
            total /
            finalLimit
          )
      },

      data
    });

  } catch (err) {

    console.error(
      "❌ /data error:",
      err
    );

    return res
      .status(500)
      .json({
        status: "error",

        error:
          err.message ||
          "Internal error"
      });
  }
});


// ================= STREAM =================

router.post(
  "/stream",
  async (req, res) => {
    try {
      const {
        question,
        prompt,
        query,
        message,
        topk
      } = req.body || {};


      const rawInput =
        question ??
        prompt ??
        query ??
        message ??
        "";

      const finalQuestion =
        typeof rawInput === "string"
          ? rawInput.trim()
          : "";


      if (!finalQuestion) {
        res.write(
          `data: Missing question\n\n`
        );

        return res.end();
      }


      const finalTopk =
        safeTopk(topk);


      res.setHeader(
        "Content-Type",
        "text/event-stream"
      );

      res.setHeader(
        "Cache-Control",
        "no-cache"
      );

      res.setHeader(
        "Connection",
        "keep-alive"
      );


      await streamScholar(
        req,
        res,
        finalQuestion,
        finalTopk
      );

    } catch (err) {

      console.error(
        "❌ Stream Scholar error:",
        err
      );

      res.write(
        `data: Error: ${err.message}\n\n`
      );

      res.write(
        `data: [DONE]\n\n`
      );

      res.end();
    }
  }
);


export default router;