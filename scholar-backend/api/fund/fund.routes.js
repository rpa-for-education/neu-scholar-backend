// api/fund/fund.routes.js
import express from "express";
import { createHash } from "node:crypto";
import { runFundAgent } from "../../agents/fund/fund.service.js";

const router = express.Router();
const FUND_MODEL_ID = "qwen2.5-14b";
const MAX_TOPK = 5;
const MAX_HISTORY = 10;
const RECENT_RESULT_TTL_MS =
  Number(process.env.FUND_DEDUP_TTL_MS) || 5000;

const inFlight = new Map();
const recentResults = new Map();

function safeTopk(value) {
  const number = Number(value);
  return Number.isFinite(number) &&
    number > 0
      ? Math.min(Math.floor(number), MAX_TOPK)
      : MAX_TOPK;
}
function questionOf(body = {}) {
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
function historyOf(context = {}) {
  if (!Array.isArray(context.history)) {
    return [];
  }
  return context.history
    .filter(item =>
      item &&
      ["user", "assistant"].includes(item.role) &&
      typeof item.content === "string" &&
      item.content.trim()
    )
    .slice(-MAX_HISTORY);
}
function prepare(req) {
  const body = req.body || {};
  return {
    question: questionOf(body),
    topk: safeTopk(body.topk),
    history: historyOf(
      body.context || {}
    ),
    sessionId:
      body.session_id ?? null
  };
}
function dedupKey(req, input) {
  const body = req.body || {};
  const identity = String(
    body.session_id ??
    body.user_id ??
    body.user ??
    "anonymous"
  ).trim();

  const history = createHash("sha256")
    .update(JSON.stringify(
      input.history.map(item => ({
        role: item.role,
        content: item.content.trim()
      }))
    ))
    .digest("hex")
    .slice(0, 16);

  return [
    identity,
    input.question
      .toLowerCase()
      .replace(/\s+/g, " "),
    FUND_MODEL_ID,
    input.topk,
    history
  ].join("::");
}
async function runDeduplicated(req, input) {
  const key = dedupKey(req, input);
  const now = Date.now();
  const recent = recentResults.get(key);

  if (
    recent &&
    recent.expiresAt > now
  ) {
    return recent.result;
  }
  if (recent) {
    recentResults.delete(key);
  }
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  // Truyền history vào service để câu hỏi tiếp nối
  // được viết lại và trả lời theo đúng ngữ cảnh.
  const promise = runFundAgent(
    req,
    input.question,
    FUND_MODEL_ID,
    input.topk,
    input.history
  );

  inFlight.set(key, promise);

  try {
    const result = await promise;
    recentResults.set(key, {
      result,
      expiresAt:
        Date.now() +
        RECENT_RESULT_TTL_MS
    });

    if (recentResults.size > 100) {
      for (const [cachedKey, value]
        of recentResults) {
        if (
          value.expiresAt <=
          Date.now()
        ) {
          recentResults.delete(cachedKey);
        }
      }
    }
    return result;
  } finally {
    if (
      inFlight.get(key) ===
      promise
    ) {
      inFlight.delete(key);
    }
  }
}
function buildSources(result) {
  // Nhánh thông thường dùng nguồn web do
  // fund.service.js trả về.
  if (result?.domain === "general") {
    return Array.isArray(result.sources)
      ? result.sources
      : [];
  }

  const funds = Array.isArray(result?.funds)
    ? result.funds
    : [];

  return funds.map((fund, index) => ({
    id: `F${index + 1}`,
    type: "fund",
    title:
      fund.title ||
      fund.opportunity_title ||
      "Untitled fund",
    url: fund.url || "",
    metadata: {
      agency:
        fund.agency ||
        fund.agency_name ||
        null,
      // Tổng kinh phí và mức tối đa mỗi
      // khoản tài trợ được giữ riêng.
      amount:
        fund.funding_amount ??
        fund.estimated_total_program_funding ??
        fund.amount ??
        fund.total_funding ??
        null,
      award_ceiling:
        fund.award_ceiling ??
        null,
      award_floor:
        fund.award_floor ??
        null,
      deadline:
        fund.deadline ||
        fund.close_date ||
        null
    }
  }));
}
function buildMeta(result) {
  return {
    response_time_ms:
      result?.responseTimeMs ??
      null,
    domain:
      result?.domain ||
      "fund",
    model_id:
      result?.model?.model_id ||
      FUND_MODEL_ID,
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
async function handleAsk(req, res) {
  try {
    const input = prepare(req);

    if (!input.question) {
      return res
        .status(400)
        .json({
          status: "error",
          error: "Missing question"
        });
    }

    const result =
      await runDeduplicated(
        req,
        input
      );
    const answer =
      typeof result?.answer === "string"
        ? result.answer.trim()
        : "";

    return res.json({
      session_id:
        input.sessionId,
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
  } catch (error) {
    console.error(
      "❌ Fund route error:",
      error
    );
    return res
      .status(500)
      .json({
        status: "error",
        error: "Internal error"
      });
  }
}

router.post("/", handleAsk);
router.post("/ask", handleAsk);

router.get("/data", async (req, res) => {
  try {
    const type = String(
      req.query.type || ""
    ).toLowerCase().trim();

    if (
      !["fund", "funds"].includes(type)
    ) {
      return res
        .status(400)
        .json({
          status: "error",
          error:
            "type must be 'funds'"
        });
    }

    const limit = Math.min(
      100,
      Math.max(
        1,
        Math.trunc(
          Number(req.query.limit)
        ) || 20
      )
    );
    const page = Math.max(
      1,
      Math.trunc(
        Number(req.query.page)
      ) || 1
    );

    const { getDb } =
      await import(
        "../../db/mongo.js"
      );
    const collection =
      (await getDb())
        .collection("fund");

    const [items, total] =
      await Promise.all([
        collection
          .find({})
          .sort({ _id: 1 })
          .skip(
            (page - 1) * limit
          )
          .limit(limit)
          .toArray(),
        collection.countDocuments({})
      ]);

    const data = items.map(item => ({
      id: item._id,
      title:
        item.opportunity_title ||
        item.title ||
        "",
      agency:
        item.agency_name ||
        item.agency ||
        "",
      amount:
        item.funding_amount ??
        item.estimated_total_program_funding ??
        item.amount ??
        item.total_funding ??
        null,
      award_ceiling:
        item.award_ceiling ??
        null,
      award_floor:
        item.award_floor ??
        null,
      deadline:
        item.close_date ||
        item.deadline ||
        null,
      country:
        item.country ||
        "",
      url:
        item.url ||
        ""
    }));

    return res.json({
      status: "success",
      type: "funds",
      pagination: {
        total,
        page,
        limit,
        total_pages:
          Math.ceil(total / limit)
      },
      data
    });
  } catch (error) {
    console.error(
      "❌ /fund/data error:",
      error
    );
    return res
      .status(500)
      .json({
        status: "error",
        error:
          error?.message ||
          "Internal error"
      });
  }
});

router.post("/stream", async (req, res) => {
  const input = prepare(req);

  res.status(
    input.question ? 200 : 400
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
  res.flushHeaders?.();

  const send = value =>
    res.write(
      `data: ${
        JSON.stringify(value)
      }\n\n`
    );

  try {
    if (!input.question) {
      send({
        type: "error",
        status: "error",
        error: "Missing question"
      });
      res.write(
        "data: [DONE]\n\n"
      );
      return res.end();
    }

    // Cùng một luồng xử lý với / và /ask.
    // SSE trả kết quả sau khi LLM xử lý xong.
    const result =
      await runDeduplicated(
        req,
        input
      );

    send({
      type: "content",
      content:
        typeof result?.answer ===
        "string"
          ? result.answer.trim()
          : ""
    });
    send({
      type: "sources",
      sources:
        buildSources(result)
    });
    send({
      type: "meta",
      meta:
        buildMeta(result)
    });
    res.write(
      "data: [DONE]\n\n"
    );
    return res.end();
  } catch (error) {
    console.error(
      "❌ Fund stream error:",
      error
    );
    send({
      type: "error",
      status: "error",
      error: "Internal error"
    });
    res.write(
      "data: [DONE]\n\n"
    );
    return res.end();
  }
});

export default router;