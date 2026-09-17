// api/scholar/scholar.routes.js

import express from "express";

import {
  runScholarAgent
} from "../../agents/scholar/scholar.service.js";


const router = express.Router();


// =====================================================
// CONFIG
// =====================================================

// Scholar Agent hiện chỉ sử dụng LLM mới.
// Không nhận model cũ từ Portal.
const SCHOLAR_MODEL_ID =
  "qwen2.5-14b";


// =====================================================
// UTILS
// =====================================================

function safeTopk(topk) {
  const n =
    Number(topk);

  return (
    Number.isFinite(n) &&
    n > 0
  )
    ? Math.min(
        Math.floor(n),
        5
      )
    : 5;
}


// =====================================================
// QUESTION
// =====================================================

function getQuestion(body = {}) {
  const {
    question,
    prompt,
    query,
    message
  } = body;


  const rawInput =
    question ??
    prompt ??
    query ??
    message ??
    "";


  return typeof rawInput === "string"
    ? rawInput.trim()
    : "";
}


// =====================================================
// HISTORY FROM PORTAL
// =====================================================

function getHistory(context = {}) {
  if (
    !Array.isArray(
      context?.history
    )
  ) {
    return [];
  }


  return context.history
    .filter(
      h =>
        h &&
        ["user", "assistant"].includes(
          h.role
        ) &&
        typeof h.content === "string" &&
        h.content.trim()
    )
    .slice(-10);
}


// =====================================================
// GREETING
// =====================================================

function applyFirstTurnGreeting(
  answer,
  context,
  history
) {
  const finalAnswer =
    typeof answer === "string"
      ? answer.trim()
      : "";


  if (!finalAnswer) {
    return "";
  }


  const fullName =
    context
      ?.user_profile
      ?.full_name
      ?.trim() ||
    "";


  const isFirstTurn =
    history.length === 0;


  if (
    !isFirstTurn ||
    !fullName
  ) {
    return finalAnswer;
  }


  const normalized =
    finalAnswer
      .toLowerCase();


  // Tránh LLM và backend cùng chào.
  if (
    normalized.startsWith(
      "xin chào"
    )
  ) {
    return finalAnswer;
  }


  return (
    `Xin chào ${fullName},\n\n` +
    finalAnswer
  );
}


// =====================================================
// DEBUG REQUEST
// =====================================================

function logRequest({
  session_id,
  question,
  topk,
  history,
  context
}) {
  console.log(
    "\n========== SCHOLAR REQUEST =========="
  );


  console.log(
    "🆔 SESSION:",
    session_id || "(none)"
  );


  console.log(
    "❓ QUESTION:",
    question
  );


  console.log(
    "🤖 MODEL:",
    SCHOLAR_MODEL_ID
  );


  console.log(
    "🔢 TOPK:",
    topk
  );


  console.log(
    "🧠 MEMORY ITEMS:",
    history.length
  );


  console.log(
    "👤 USER:",
    context
      ?.user_profile
      ?.full_name ||
    "(none)"
  );


  console.log(
    "📌 PROJECT:",
    context
      ?.project_info
      ?.name ||
    context?.project ||
    "(none)"
  );


  console.log(
    "📄 DOCUMENTS:",
    Array.isArray(
      context
        ?.extra_data
        ?.document
    )
      ? context.extra_data.document.length
      : 0
  );


  console.log(
    "=====================================\n"
  );
}


// =====================================================
// RESPONSE META
// =====================================================

function buildMeta(result) {
  return {
    response_time_ms:
      result?.responseTimeMs ??
      null,

    domain:
      result?.domain ||
      "general",

    model_id:
      result?.model?.model_id ||
      SCHOLAR_MODEL_ID,

    model:
      result?.model?.model ||
      null,

    llm_latency_ms:
      result?.model?.latency ??
      null,

    prompt_tokens:
      result?.model?.prompt_tokens ??
      null,

    output_tokens:
      result?.model?.output_tokens ??
      null
  };
}


// =====================================================
// CORE ASK
// =====================================================

async function handleAsk(
  req,
  res
) {
  try {

    const {
      session_id,
      topk,
      context = {}
    } = req.body || {};


    // =================================================
    // QUESTION
    // =================================================

    const finalQuestion =
      getQuestion(
        req.body || {}
      );


    if (!finalQuestion) {
      return res
        .status(400)
        .json({
          status:
            "error",

          error:
            "Missing question"
        });
    }


    // =================================================
    // TOP K
    // =================================================

    const finalTopk =
      safeTopk(topk);


    // =================================================
    // HISTORY
    // =================================================

    const history =
      getHistory(context);


    // =================================================
    // DEBUG
    // =================================================

    logRequest({
      session_id,
      question:
        finalQuestion,
      topk:
        finalTopk,
      history,
      context
    });


    // =================================================
    // RUN SCHOLAR AGENT
    //
    // Luồng duy nhất:
    //
    // route
    //   ↓
    // scholar.service.js
    //   ↓
    // runAgent / Qdrant
    //   ↓
    // buildScholarPrompt
    //   ↓
    // shared/llm.js
    //   ↓
    // qwen2.5:14b-instruct-ctx16k
    // =================================================

    const result =
      await runScholarAgent(
        req,
        finalQuestion,
        SCHOLAR_MODEL_ID,
        finalTopk,
        history
      );


    // =================================================
    // GREETING
    // =================================================

    const finalAnswer =
      applyFirstTurnGreeting(
        result?.answer,
        context,
        history
      );


    const fullName =
      context
        ?.user_profile
        ?.full_name
        ?.trim() ||
      "";


    console.log(
      "👤 FULL NAME:",
      fullName ||
      "(empty)"
    );


    console.log(
      "🆕 FIRST TURN:",
      history.length === 0
    );


    // =================================================
    // RESPONSE
    // =================================================

    return res.json({
      session_id:
        session_id ??
        null,

      status:
        "success",

      content_markdown:
        finalAnswer,

      answer:
        finalAnswer,

      // Sources chỉ build tại service.
      sources:
        result?.sources ||
        [],

      meta:
        buildMeta(result)
    });


  } catch (err) {

    console.error(
      "❌ Scholar error:",
      err
    );


    return res
      .status(500)
      .json({
        status:
          "error",

        error:
          err?.message ||
          "Internal error"
      });
  }
}


// =====================================================
// ROUTES
// =====================================================

router.post(
  "/",
  handleAsk
);


router.post(
  "/ask",
  handleAsk
);


// =====================================================
// DATA API
// =====================================================

router.get(
  "/data",
  async (req, res) => {
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
            status:
              "error",

            error:
              "type must be 'conferences' or 'journals'"
          });
      }


      // =================================================
      // PAGINATION
      // =================================================

      const parsedLimit =
        Number(limit);


      const finalLimit =
        Math.min(
          Number.isFinite(
            parsedLimit
          ) &&
          parsedLimit > 0
            ? Math.floor(
                parsedLimit
              )
            : 20,
          100
        );


      const parsedPage =
        Number(page);


      const finalPage =
        Number.isFinite(
          parsedPage
        ) &&
        parsedPage > 0
          ? Math.floor(
              parsedPage
            )
          : 1;


      const skip =
        (finalPage - 1) *
        finalLimit;


      // =================================================
      // DATABASE
      // =================================================

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
      ] =
        await Promise.all([

          col
            .find({})
            .skip(skip)
            .limit(finalLimit)
            .toArray(),

          col.countDocuments({})
        ]);


      let data = [];


      // =================================================
      // CONFERENCES
      // =================================================

      if (
        t === "conferences"
      ) {
        data =
          items.map(
            c => ({
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
                c.cfp_link ||
                c.url ||
                c.link ||
                c.website ||
                ""
            })
          );
      }


      // =================================================
      // JOURNALS
      // =================================================

      if (
        t === "journals"
      ) {
        data =
          items.map(
            j => ({
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
            })
          );
      }


      // =================================================
      // RESPONSE
      // =================================================

      return res.json({
        status:
          "success",

        type:
          t,

        pagination: {
          total,

          page:
            finalPage,

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
          status:
            "error",

          error:
            err?.message ||
            "Internal error"
        });
    }
  }
);


// =====================================================
// STREAM
//
// QUAN TRỌNG:
// Không import / gọi scholar.stream.js cũ.
//
// Endpoint này sử dụng chính Scholar Agent mới.
// Vì callLLM hiện dùng stream:false,
// đây là SSE response sau khi LLM hoàn thành,
// chưa phải token-by-token streaming.
// =====================================================

router.post(
  "/stream",
  async (req, res) => {

    try {

      const {
        session_id,
        topk,
        context = {}
      } = req.body || {};


      // =================================================
      // QUESTION
      // =================================================

      const finalQuestion =
        getQuestion(
          req.body || {}
        );


      if (!finalQuestion) {

        res.status(400);

        res.setHeader(
          "Content-Type",
          "text/event-stream; charset=utf-8"
        );


        res.write(
          `data: ${JSON.stringify({
            status:
              "error",

            error:
              "Missing question"
          })}\n\n`
        );


        res.write(
          "data: [DONE]\n\n"
        );


        return res.end();
      }


      // =================================================
      // TOP K
      // =================================================

      const finalTopk =
        safeTopk(topk);


      // =================================================
      // HISTORY
      // =================================================

      const history =
        getHistory(context);


      // =================================================
      // SSE HEADERS
      // =================================================

      res.status(200);


      res.setHeader(
        "Content-Type",
        "text/event-stream; charset=utf-8"
      );


      res.setHeader(
        "Cache-Control",
        "no-cache, no-transform"
      );


      res.setHeader(
        "Connection",
        "keep-alive"
      );


      res.setHeader(
        "X-Accel-Buffering",
        "no"
      );


      if (
        typeof res.flushHeaders ===
        "function"
      ) {
        res.flushHeaders();
      }


      // =================================================
      // DEBUG
      // =================================================

      console.log(
        "\n========== SCHOLAR STREAM REQUEST =========="
      );


      console.log(
        "🆔 SESSION:",
        session_id ||
        "(none)"
      );


      console.log(
        "❓ QUESTION:",
        finalQuestion
      );


      console.log(
        "🤖 MODEL:",
        SCHOLAR_MODEL_ID
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
        "============================================\n"
      );


      // =================================================
      // RUN SAME NEW SCHOLAR AGENT
      // =================================================

      const result =
        await runScholarAgent(
          req,
          finalQuestion,
          SCHOLAR_MODEL_ID,
          finalTopk,
          history
        );


      // =================================================
      // GREETING
      // =================================================

      const finalAnswer =
        applyFirstTurnGreeting(
          result?.answer,
          context,
          history
        );


      // =================================================
      // SSE CONTENT
      // =================================================

      res.write(
        `data: ${JSON.stringify({
          type:
            "content",

          content:
            finalAnswer
        })}\n\n`
      );


      // =================================================
      // SSE SOURCES
      // =================================================

      res.write(
        `data: ${JSON.stringify({
          type:
            "sources",

          sources:
            result?.sources ||
            []
        })}\n\n`
      );


      // =================================================
      // SSE META
      // =================================================

      res.write(
        `data: ${JSON.stringify({
          type:
            "meta",

          meta:
            buildMeta(result)
        })}\n\n`
      );


      // =================================================
      // DONE
      // =================================================

      res.write(
        "data: [DONE]\n\n"
      );


      return res.end();


    } catch (err) {

      console.error(
        "❌ Stream Scholar error:",
        err
      );


      if (
        !res.headersSent
      ) {
        res.status(500);

        res.setHeader(
          "Content-Type",
          "text/event-stream; charset=utf-8"
        );
      }


      res.write(
        `data: ${JSON.stringify({
          type:
            "error",

          error:
            err?.message ||
            "Internal error"
        })}\n\n`
      );


      res.write(
        "data: [DONE]\n\n"
      );


      return res.end();
    }
  }
);


export default router;