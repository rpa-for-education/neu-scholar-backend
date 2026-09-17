// api/fund/fund.routes.js

import express from "express";
import { runFundAgent } from "../../agents/fund/fund.service.js";

const router = express.Router();


// =====================================================
// CONFIG
// =====================================================

const FUND_MODEL_ID = "qwen2.5-14b";

const MAX_TOPK = 5;

const RECENT_RESULT_TTL_MS =
  Number(process.env.FUND_DEDUP_TTL_MS) || 5000;


// =====================================================
// DEDUP STORAGE
// =====================================================

/**
 * Request đang chạy:
 * key -> Promise
 */
const inFlight = new Map();


/**
 * Request vừa hoàn thành:
 * key -> { result, expiresAt }
 *
 * Cache rất ngắn để hấp thụ retry hoặc /stream
 * đến ngay sau / hoặc /ask.
 */
const recentResults = new Map();


// =====================================================
// REQUEST UTILS
// =====================================================

function safeTopk(value) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) {
    return MAX_TOPK;
  }

  return Math.min(
    Math.floor(n),
    MAX_TOPK
  );
}


function getQuestion(body = {}) {
  const raw =
    body.question ??
    body.prompt ??
    body.query ??
    body.message ??
    "";

  return typeof raw === "string"
    ? raw.trim()
    : "";
}


function getRequestIdentity(body = {}) {
  return String(
    body.session_id ??
    body.user_id ??
    body.user ??
    "anonymous"
  ).trim();
}


function normalizeKeyPart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}


function buildDedupKey({
  body,
  question,
  topk
}) {
  return [
    normalizeKeyPart(
      getRequestIdentity(body)
    ),
    normalizeKeyPart(question),
    FUND_MODEL_ID,
    String(topk)
  ].join("::");
}


// =====================================================
// LOGGING
// =====================================================

function logRequest({
  endpoint,
  sessionId,
  question,
  topk
}) {
  console.log(
    "\n========== FUND REQUEST =========="
  );

  console.log(
    "🔗 ENDPOINT:",
    endpoint
  );

  console.log(
    "🆔 SESSION:",
    sessionId || "(none)"
  );

  console.log(
    "❓ QUESTION:",
    question
  );

  console.log(
    "🤖 MODEL:",
    FUND_MODEL_ID
  );

  console.log(
    "🔢 TOPK:",
    topk
  );

  console.log(
    "==================================\n"
  );
}


// =====================================================
// RESULT CACHE
// =====================================================

function getRecentResult(key) {
  const cached =
    recentResults.get(key);

  if (!cached) {
    return null;
  }

  if (
    Date.now() >= cached.expiresAt
  ) {
    recentResults.delete(key);
    return null;
  }

  return cached.result;
}


function saveRecentResult(
  key,
  result
) {
  recentResults.set(key, {
    result,
    expiresAt:
      Date.now() +
      RECENT_RESULT_TTL_MS
  });

  // Opportunistic cleanup.
  if (recentResults.size > 100) {
    const now =
      Date.now();

    for (
      const [cachedKey, cached]
      of recentResults
    ) {
      if (
        now >= cached.expiresAt
      ) {
        recentResults.delete(
          cachedKey
        );
      }
    }
  }
}


// =====================================================
// DEDUP CORE
//
// Đây là nơi DUY NHẤT route gọi runFundAgent().
// /, /ask và /stream đều đi qua đây.
// =====================================================

async function runDeduplicated({
  req,
  question,
  topk
}) {
  const body =
    req.body || {};

  const key =
    buildDedupKey({
      body,
      question,
      topk
    });

  // -------------------------------------------------
  // 1. Request vừa hoàn thành
  // -------------------------------------------------

  const recent =
    getRecentResult(key);

  if (recent) {
    console.log(
      "♻️ FUND DEDUP: recent result reused"
    );

    return recent;
  }

  // -------------------------------------------------
  // 2. Request giống hệt đang chạy
  // -------------------------------------------------

  const running =
    inFlight.get(key);

  if (running) {
    console.log(
      "🔁 FUND DEDUP: joining in-flight request"
    );

    return await running;
  }

  // -------------------------------------------------
  // 3. Request mới
  // -------------------------------------------------

  console.log(
    "🆕 FUND DEDUP: starting new request"
  );

  const promise =
    runFundAgent(
      req,
      question,
      FUND_MODEL_ID,
      topk
    );

  inFlight.set(
    key,
    promise
  );

  try {
    const result =
      await promise;

    saveRecentResult(
      key,
      result
    );

    return result;

  } finally {
    if (
      inFlight.get(key) === promise
    ) {
      inFlight.delete(key);
    }
  }
}


// =====================================================
// PREPARE REQUEST
// =====================================================

function prepareRequest(req) {
  const body =
    req.body || {};

  return {
    body,

    question:
      getQuestion(body),

    topk:
      safeTopk(body.topk),

    sessionId:
      body.session_id ?? null
  };
}


// =====================================================
// BUILD SOURCES
// =====================================================

function buildSources(result) {
  const funds =
    Array.isArray(result?.funds)
      ? result.funds
      : [];

  return funds.map(
    (fund, index) => ({
      id:
        `F${index + 1}`,

      type:
        "fund",

      title:
        fund?.title ||
        fund?.opportunity_title ||
        "Untitled fund",

      url:
        fund?.url || "",

      metadata: {
        agency:
          fund?.agency ||
          fund?.agency_name ||
          null,

        amount:
          fund?.amount ??
          fund?.funding_amount ??
          null,

        deadline:
          fund?.deadline ||
          fund?.close_date ||
          null
      }
    })
  );
}


// =====================================================
// META
// =====================================================

function buildMeta(result) {
  return {
    response_time_ms:
      result?.responseTimeMs ?? null,

    domain:
      result?.domain || "fund",

    model_id:
      result?.model?.model_id ||
      FUND_MODEL_ID,

    model:
      result?.model?.model || null,

    llm_latency_ms:
      result?.model?.latency ?? null,

    prompt_tokens:
      result?.model?.prompt_tokens ?? null,

    output_tokens:
      result?.model?.output_tokens ?? null
  };
}


// =====================================================
// NORMAL JSON HANDLER
//
// Used by:
// POST /
// POST /ask
// =====================================================

async function handleAsk(
  req,
  res
) {
  try {
    const {
      question,
      topk,
      sessionId
    } = prepareRequest(req);

    if (!question) {
      return res
        .status(400)
        .json({
          status: "error",
          error: "Missing question"
        });
    }

    logRequest({
      endpoint:
        req.originalUrl,

      sessionId,
      question,
      topk
    });

    const result =
      await runDeduplicated({
        req,
        question,
        topk
      });

    const answer =
      typeof result?.answer === "string"
        ? result.answer.trim()
        : "";

    return res.json({
      session_id:
        sessionId,

      status:
        "success",

      content_markdown:
        answer,

      answer,

      sources:
        buildSources(result),

      meta:
        buildMeta(result)
    });

  } catch (err) {
    console.error(
      "❌ Fund error:",
      err
    );

    return res
      .status(500)
      .json({
        status: "error",

        error:
          err?.message ||
          "Internal error"
      });
  }
}


// =====================================================
// POST /
// =====================================================

router.post(
  "/",
  handleAsk
);


// =====================================================
// POST /ask
// =====================================================

router.post(
  "/ask",
  handleAsk
);


// =====================================================
// GET /data
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

      const normalizedType =
        String(type || "")
          .trim()
          .toLowerCase();

      if (
        ![
          "fund",
          "funds"
        ].includes(normalizedType)
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            error:
              "type must be 'funds'"
          });
      }

      // ---------------------------------------------
      // Pagination
      // ---------------------------------------------

      const rawLimit =
        Number(limit);

      const finalLimit =
        Math.min(
          Number.isFinite(rawLimit) &&
          rawLimit > 0
            ? Math.floor(rawLimit)
            : 20,
          100
        );

      const rawPage =
        Number(page);

      const finalPage =
        Number.isFinite(rawPage) &&
        rawPage > 0
          ? Math.floor(rawPage)
          : 1;

      const skip =
        (finalPage - 1) *
        finalLimit;

      // ---------------------------------------------
      // MongoDB
      // ---------------------------------------------

      const { getDb } =
        await import(
          "../../db/mongo.js"
        );

      const db =
        await getDb();

      const collection =
        db.collection("fund");

      const [items, total] =
        await Promise.all([
          collection
            .find({})
            .skip(skip)
            .limit(finalLimit)
            .toArray(),

          collection
            .countDocuments({})
        ]);

      // ---------------------------------------------
      // Mapping
      //
      // Hỗ trợ cả field chuẩn mới và alias cũ.
      // ---------------------------------------------

      const data =
        items.map(f => ({
          id:
            f._id,

          title:
            f.opportunity_title ||
            f.title ||
            "",

          agency:
            f.agency_name ||
            f.agency ||
            "",

          amount:
            f.funding_amount ??
            f.amount ??
            null,

          deadline:
            f.close_date ||
            f.deadline ||
            null,

          country:
            f.country ||
            "",

          url:
            f.url ||
            ""
        }));

      return res.json({
        status:
          "success",

        type:
          "funds",

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
        "❌ /fund/data error:",
        err
      );

      return res
        .status(500)
        .json({
          status: "error",

          error:
            err?.message ||
            "Internal error"
        });
    }
  }
);


// =====================================================
// POST /stream
//
// Giữ endpoint SSE để tương thích Portal.
//
// QUAN TRỌNG:
// - Không gọi fund.stream.js.
// - Không chạy pipeline LLM thứ hai.
// - Dùng chung runDeduplicated() với / và /ask.
// - Hiện là buffered SSE, chưa phải token streaming.
// =====================================================

router.post(
  "/stream",
  async (req, res) => {
    try {
      const {
        question,
        topk,
        sessionId
      } = prepareRequest(req);

      // ---------------------------------------------
      // SSE headers
      // ---------------------------------------------

      res.status(
        question ? 200 : 400
      );

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

      // ---------------------------------------------
      // Validation
      // ---------------------------------------------

      if (!question) {
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            status: "error",
            error: "Missing question"
          })}\n\n`
        );

        res.write(
          "data: [DONE]\n\n"
        );

        return res.end();
      }

      // ---------------------------------------------
      // Logging
      // ---------------------------------------------

      logRequest({
        endpoint:
          req.originalUrl,

        sessionId,
        question,
        topk
      });

      console.log(
        "🌊 FUND SSE MODE: buffered result"
      );

      // ---------------------------------------------
      // SAME DEDUP CORE
      // ---------------------------------------------

      const result =
        await runDeduplicated({
          req,
          question,
          topk
        });

      const answer =
        typeof result?.answer === "string"
          ? result.answer.trim()
          : "";

      // ---------------------------------------------
      // Content
      // ---------------------------------------------

      res.write(
        `data: ${JSON.stringify({
          type: "content",
          content: answer
        })}\n\n`
      );

      // ---------------------------------------------
      // Sources
      // ---------------------------------------------

      res.write(
        `data: ${JSON.stringify({
          type: "sources",
          sources:
            buildSources(result)
        })}\n\n`
      );

      // ---------------------------------------------
      // Meta
      // ---------------------------------------------

      res.write(
        `data: ${JSON.stringify({
          type: "meta",
          meta:
            buildMeta(result)
        })}\n\n`
      );

      // ---------------------------------------------
      // Done
      // ---------------------------------------------

      res.write(
        "data: [DONE]\n\n"
      );

      return res.end();

    } catch (err) {
      console.error(
        "❌ Stream Fund error:",
        err
      );

      if (!res.headersSent) {
        res.status(500);

        res.setHeader(
          "Content-Type",
          "text/event-stream; charset=utf-8"
        );
      }

      res.write(
        `data: ${JSON.stringify({
          type: "error",

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