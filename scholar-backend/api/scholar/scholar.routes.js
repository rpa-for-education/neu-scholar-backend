// api/scholar/scholar.routes.js

import express from "express";
import { createHash } from "node:crypto";
import { runScholarAgent } from "../../agents/scholar/scholar.service.js";

const router = express.Router();


// =====================================================
// CONFIG
// =====================================================

const SCHOLAR_MODEL_ID = "qwen2.5-14b";

const MAX_TOPK = 5;
const MAX_HISTORY = 10;

/**
 * Khoảng thời gian giữ kết quả vừa hoàn thành.
 *
 * Mục đích:
 * - chặn retry xảy ra ngay sau khi request đầu tiên vừa xong
 * - tránh Portal gọi / và /stream gần như đồng thời nhưng lệch vài ms
 *
 * Đây KHÔNG phải cache dài hạn.
 */
const RECENT_RESULT_TTL_MS =
  Number(process.env.SCHOLAR_DEDUP_TTL_MS) || 5000;


// =====================================================
// IN-FLIGHT DEDUPLICATION
// =====================================================

/**
 * key -> Promise
 *
 * Khi một Scholar request đang chạy, các request giống hệt
 * sẽ await cùng Promise thay vì chạy runScholarAgent() lần nữa.
 */
const inFlight = new Map();


/**
 * Cache rất ngắn cho request vừa hoàn thành.
 *
 * key -> {
 *   result,
 *   expiresAt
 * }
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


function getHistory(context = {}) {
  if (!Array.isArray(context?.history)) {
    return [];
  }

  return context.history
    .filter(
      item =>
        item &&
        ["user", "assistant"].includes(item.role) &&
        typeof item.content === "string" &&
        item.content.trim()
    )
    .slice(-MAX_HISTORY);
}


/**
 * Session là thành phần quan trọng nhất của dedup key.
 *
 * Nếu Portal không gửi session_id, fallback sang user/user_id.
 * Không dùng một key global vì hai người khác nhau có thể hỏi
 * cùng một câu hỏi.
 */
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


/**
 * History ảnh hưởng trực tiếp đến contextual query rewrite.
 *
 * Ví dụ cùng câu:
 * "Còn Q2 thì sao?"
 *
 * nhưng history khác nhau có thể tạo ra standalone query
 * hoàn toàn khác nhau.
 *
 * Vì vậy dedup key bắt buộc phải phân biệt history.
 *
 * Dùng SHA-256 để tránh đưa toàn bộ nội dung history
 * vào key của Map.
 */
function buildHistoryFingerprint(history = []) {
  if (!Array.isArray(history) || !history.length) {
    return "no-history";
  }

  const payload = history
    .map(item => ({
      role: item?.role || "",
      content: normalizeKeyPart(
        item?.content || ""
      )
    }))
    .filter(
      item =>
        item.role &&
        item.content
    );

  if (!payload.length) {
    return "no-history";
  }

  return createHash("sha256")
    .update(
      JSON.stringify(payload)
    )
    .digest("hex")
    .slice(0, 16);
}


function buildDedupKey({
  body,
  question,
  topk,
  history
}) {
  const identity =
    getRequestIdentity(body);

  return [
    normalizeKeyPart(identity),
    normalizeKeyPart(question),
    SCHOLAR_MODEL_ID,
    String(topk),
    buildHistoryFingerprint(history)
  ].join("::");
}


// =====================================================
// LOGGING
// =====================================================

function logRequest({
  sessionId,
  question,
  topk,
  history,
  context,
  endpoint
}) {
  console.log(
    "\n========== SCHOLAR REQUEST =========="
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
}


// =====================================================
// META
// =====================================================

function buildMeta(result) {
  return {
    response_time_ms:
      result?.responseTimeMs ?? null,

    domain:
      result?.domain || "general",

    model_id:
      result?.model?.model_id ||
      SCHOLAR_MODEL_ID,

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

  if (
    history.length !== 0 ||
    !fullName
  ) {
    return finalAnswer;
  }

  if (
    finalAnswer
      .toLowerCase()
      .startsWith("xin chào")
  ) {
    return finalAnswer;
  }

  return (
    `Xin chào ${fullName},\n\n` +
    finalAnswer
  );
}


// =====================================================
// DEDUP CORE
// =====================================================

function getRecentResult(key) {
  const cached =
    recentResults.get(key);

  if (!cached) {
    return null;
  }

  if (
    Date.now() >=
    cached.expiresAt
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
  recentResults.set(
    key,
    {
      result,
      expiresAt:
        Date.now() +
        RECENT_RESULT_TTL_MS
    }
  );

  /**
   * Không cần timer riêng cho từng request.
   *
   * Cleanup opportunistic để tránh Map tăng mãi.
   */
  if (
    recentResults.size > 100
  ) {
    const now =
      Date.now();

    for (
      const [
        cachedKey,
        cached
      ] of recentResults
    ) {
      if (
        now >=
        cached.expiresAt
      ) {
        recentResults.delete(
          cachedKey
        );
      }
    }
  }
}


/**
 * Đây là điểm DUY NHẤT route gọi runScholarAgent().
 *
 * /, /ask và /stream đều phải đi qua hàm này.
 */
async function runDeduplicated({
  req,
  question,
  topk,
  history
}) {
  const body =
    req.body || {};

  const key =
    buildDedupKey({
      body,
      question,
      topk,
      history
    });


  // -----------------------------------------------
  // 1. Request vừa hoàn thành
  // -----------------------------------------------

  const recent =
    getRecentResult(key);

  if (recent) {
    console.log(
      "♻️ SCHOLAR DEDUP: recent result reused"
    );

    return recent;
  }


  // -----------------------------------------------
  // 2. Request đang chạy
  // -----------------------------------------------

  const running =
    inFlight.get(key);

  if (running) {
    console.log(
      "🔁 SCHOLAR DEDUP: joining in-flight request"
    );

    return await running;
  }


  // -----------------------------------------------
  // 3. Request mới
  // -----------------------------------------------

  console.log(
    "🆕 SCHOLAR DEDUP: starting new request"
  );

  const promise =
    runScholarAgent(
      req,
      question,
      SCHOLAR_MODEL_ID,
      topk,
      history
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
    /**
     * Chỉ xóa nếu Map vẫn chứa
     * chính Promise này.
     */
    if (
      inFlight.get(key) ===
      promise
    ) {
      inFlight.delete(key);
    }
  }
}


// =====================================================
// PREPARE SCHOLAR REQUEST
// =====================================================

function prepareRequest(req) {
  const body =
    req.body || {};

  const context =
    body.context || {};

  const question =
    getQuestion(body);

  const topk =
    safeTopk(
      body.topk
    );

  const history =
    getHistory(
      context
    );

  return {
    body,
    context,
    question,
    topk,
    history,

    sessionId:
      body.session_id ??
      null
  };
}


// =====================================================
// NORMAL JSON RESPONSE
// Used by POST / and POST /ask
// =====================================================

async function handleAsk(
  req,
  res
) {
  try {
    const prepared =
      prepareRequest(req);

    const {
      context,
      question,
      topk,
      history,
      sessionId
    } = prepared;

    if (!question) {
      return res
        .status(400)
        .json({
          status: "error",
          error:
            "Missing question"
        });
    }

    logRequest({
      sessionId,
      question,
      topk,
      history,
      context,
      endpoint:
        req.originalUrl
    });

    const result =
      await runDeduplicated({
        req,
        question,
        topk,
        history
      });

    const finalAnswer =
      applyFirstTurnGreeting(
        result?.answer,
        context,
        history
      );

    return res.json({
      session_id:
        sessionId,

      status:
        "success",

      content_markdown:
        finalAnswer,

      answer:
        finalAnswer,

      sources:
        result?.sources || [],

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
  async (
    req,
    res
  ) => {
    try {
      const {
        type,
        limit = 20,
        page = 1
      } = req.query;

      const normalizedType =
        String(
          type || ""
        )
          .trim()
          .toLowerCase();

      if (
        ![
          "conferences",
          "journals"
        ].includes(
          normalizedType
        )
      ) {
        return res
          .status(400)
          .json({
            status: "error",

            error:
              "type must be 'conferences' or 'journals'"
          });
      }


      // ---------------------------------------------
      // Pagination
      // ---------------------------------------------

      const rawLimit =
        Number(limit);

      const finalLimit =
        Math.min(
          Number.isFinite(
            rawLimit
          ) &&
          rawLimit > 0
            ? Math.floor(
                rawLimit
              )
            : 20,
          100
        );


      const rawPage =
        Number(page);

      const finalPage =
        Number.isFinite(
          rawPage
        ) &&
        rawPage > 0
          ? Math.floor(
              rawPage
            )
          : 1;


      const skip =
        (
          finalPage - 1
        ) *
        finalLimit;


      // ---------------------------------------------
      // MongoDB
      // ---------------------------------------------

      const {
        getDb
      } =
        await import(
          "../../db/mongo.js"
        );

      const db =
        await getDb();


      const collectionName =
        normalizedType ===
        "conferences"
          ? "conference"
          : "journal";


      const collection =
        db.collection(
          collectionName
        );


      const [
        items,
        total
      ] =
        await Promise.all([
          collection
            .find({})
            /**
             * Explicit sort giúp pagination ổn định.
             *
             * Nếu không sort, MongoDB không đảm bảo
             * thứ tự tự nhiên giữa các request.
             */
            .sort({
              _id: 1
            })
            .skip(skip)
            .limit(
              finalLimit
            )
            .toArray(),

          collection
            .countDocuments({})
        ]);


      // ---------------------------------------------
      // Response mapping
      // ---------------------------------------------

      const data =
        normalizedType ===
        "conferences"

          ? items.map(
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
            )

          : items.map(
              j => ({
                id:
                  j._id,

                title:
                  j.title,

                publisher:
                  j.publisher,

                /**
                 * Ưu tiên quartile canonical.
                 *
                 * Không suy ra quartile tổng thể
                 * từ categories/areas.
                 */
                quartile:
                  j.quartile ||
                  j.sjr_best_quartile ||
                  j.best_quartile ||
                  j.sjr_quartile ||
                  "",

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


      return res.json({
        status:
          "success",

        type:
          normalizedType,

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
// POST /stream
//
// Vẫn giữ contract SSE hiện tại.
//
// LƯU Ý:
// Đây chưa phải token-by-token streaming.
// Nó sử dụng cùng Scholar result với / và /ask.
//
// Nếu cùng request đang chạy:
// → JOIN Promise hiện có
// → KHÔNG gọi Qwen lần thứ hai.
// =====================================================

router.post(
  "/stream",
  async (
    req,
    res
  ) => {
    try {
      const prepared =
        prepareRequest(req);

      const {
        context,
        question,
        topk,
        history,
        sessionId
      } = prepared;


      // ---------------------------------------------
      // SSE headers
      // ---------------------------------------------

      res.status(
        question
          ? 200
          : 400
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
            type:
              "error",

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


      // ---------------------------------------------
      // Logging
      // ---------------------------------------------

      logRequest({
        sessionId,
        question,
        topk,
        history,
        context,
        endpoint:
          req.originalUrl
      });

      console.log(
        "🌊 SSE MODE: buffered result"
      );


      // ---------------------------------------------
      // SAME DEDUP CORE AS / AND /ask
      // ---------------------------------------------

      const result =
        await runDeduplicated({
          req,
          question,
          topk,
          history
        });


      const finalAnswer =
        applyFirstTurnGreeting(
          result?.answer,
          context,
          history
        );


      // ---------------------------------------------
      // Content
      // ---------------------------------------------

      res.write(
        `data: ${JSON.stringify({
          type:
            "content",

          content:
            finalAnswer
        })}\n\n`
      );


      // ---------------------------------------------
      // Sources
      // ---------------------------------------------

      res.write(
        `data: ${JSON.stringify({
          type:
            "sources",

          sources:
            result?.sources ||
            []
        })}\n\n`
      );


      // ---------------------------------------------
      // Meta
      // ---------------------------------------------

      res.write(
        `data: ${JSON.stringify({
          type:
            "meta",

          meta:
            buildMeta(
              result
            )
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