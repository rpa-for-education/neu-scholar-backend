// agents/scholar/scholar.stream.js

import { runAgent } from "./scholar.agent.js";

import {
  addToHistory
} from "../../middlewares/session.js";

import {
  buildScholarPrompt
} from "./scholar.prompt.js";

import {
  buildLLMContext
} from "../shared/context.js";

import {
  normalizeHistory
} from "../shared/memory.js";


// =====================================================
// CONFIG
// =====================================================

const OLLAMA_LLM_BASE = (
  process.env.OLLAMA_LLM_BASE_URL ||
  "http://101.96.66.232:8037/ollama"
).replace(/\/+$/, "");


const OLLAMA_LLM_SECKEY =
  process.env.OLLAMA_LLM_SECKEY ||
  "";


const OLLAMA_LLM_MODEL =
  process.env.OLLAMA_LLM_MODEL ||
  "qwen2.5:14b-instruct-ctx16k";


const LLM_TIMEOUT =
  Number(
    process.env.LLM_TIMEOUT_MS
  ) || 120000;


const LLM_NUM_CTX =
  Number(
    process.env.LLM_NUM_CTX
  ) || 16384;


const parsedTemperature =
  Number(
    process.env.LLM_TEMPERATURE
  );


const LLM_TEMPERATURE =
  Number.isFinite(
    parsedTemperature
  )
    ? parsedTemperature
    : 0.2;


// =====================================================
// SSE HELPERS
// =====================================================

function sendSSE(
  res,
  data
) {
  if (
    res.writableEnded ||
    res.destroyed
  ) {
    return;
  }


  const payload =
    typeof data === "string"
      ? data
      : JSON.stringify(data);


  res.write(
    `data: ${payload}\n\n`
  );


  if (
    typeof res.flush === "function"
  ) {
    res.flush();
  }
}


// =====================================================
// MAIN
// =====================================================

export async function streamScholar(
  req,
  res,
  question,
  topk = 5
) {

  const start =
    Date.now();


  let heartbeat =
    null;


  let controller =
    null;


  let closed =
    false;


  let result =
    null;


  let finalText =
    "";


  try {

    // =================================================
    // 1. SSE HEADERS
    // =================================================

    if (!res.headersSent) {

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
    }


    // =================================================
    // 2. CLIENT DISCONNECT
    // =================================================

    req.on(
      "close",
      () => {

        closed =
          true;


        console.warn(
          "⚠️ Scholar stream client disconnected"
        );


        if (heartbeat) {
          clearInterval(
            heartbeat
          );
        }


        if (controller) {
          controller.abort();
        }
      }
    );


    // =================================================
    // 3. HEARTBEAT
    // =================================================

    heartbeat =
      setInterval(
        () => {

          if (
            !closed &&
            !res.writableEnded
          ) {
            res.write(
              ": heartbeat\n\n"
            );
          }

        },
        10000
      );


    // =================================================
    // 4. MEMORY / CONTEXT
    // =================================================

    const history =
      normalizeHistory(
        req.body
          ?.context
          ?.history ||
        []
      );


    const llmContext =
      buildLLMContext(req);


    // Đồng bộ với scholar.service.js:
    // history đã normalize là nguồn dùng cho prompt.
    llmContext.history =
      history;


    console.log(
      "\n========== SCHOLAR STREAM =========="
    );


    console.log(
      "❓ QUESTION:",
      question
    );


    console.log(
      "🔢 TOPK:",
      topk
    );


    console.log(
      "🧠 HISTORY ITEMS:",
      history.length
    );


    console.log(
      "👤 PROFILE:",
      llmContext
        ?.profile
        ?.full_name ||
      "(none)"
    );


    console.log(
      "📌 PROJECT:",
      llmContext
        ?.project
        ?.name ||
      "(none)"
    );


    console.log(
      "📄 DOCUMENTS:",
      llmContext
        ?.docs
        ?.length ||
      0
    );


    console.log(
      "====================================\n"
    );


    // =================================================
    // 5. SEARCH
    //
    // Giữ nguyên nguyên tắc hiện tại:
    // embedding chỉ nhận question.
    //
    // Không đưa raw history / document vào embedding.
    // =================================================

    sendSSE(
      res,
      {
        type:
          "status",

        message:
          "Đang tìm dữ liệu..."
      }
    );


    result =
      await runAgent(
        question,
        topk
      );


    if (closed) {
      return;
    }


    const conferences =
      Array.isArray(
        result?.conferences
      )
        ? result.conferences
        : [];


    const journals =
      Array.isArray(
        result?.journals
      )
        ? result.journals
        : [];


    console.log(
      "📊 STREAM SEARCH:",
      conferences.length,
      journals.length
    );


    // Không return sớm khi search = 0.
    //
    // User vẫn có thể hỏi:
    // - nội dung document
    // - project
    // - profile
    // - history
    //
    // LLM phải được quyền trả lời
    // từ các context này.


    sendSSE(
      res,
      {
        type:
          "status",

        message:
          "Đang phân tích..."
      }
    );


    // =================================================
    // 6. BUILD PROMPT
    // =================================================

    const prompt =
      buildScholarPrompt(
        question,
        conferences,
        journals,
        llmContext
      );


    console.log(
      "📝 STREAM PROMPT:",
      prompt.length,
      "chars"
    );


    // =================================================
    // 7. CALL NEW LLM
    // =================================================

    const url =
      `${OLLAMA_LLM_BASE}/api/generate`;


    controller =
      new AbortController();


    const timeoutId =
      setTimeout(
        () => {

          if (
            controller &&
            !controller.signal.aborted
          ) {
            controller.abort();
          }

        },
        LLM_TIMEOUT
      );


    console.log(
      "\n========== LLM STREAM REQUEST =========="
    );


    console.log(
      "🌐 URL:",
      url
    );


    console.log(
      "🧠 MODEL:",
      OLLAMA_LLM_MODEL
    );


    console.log(
      "📏 PROMPT CHARS:",
      prompt.length
    );


    console.log(
      "🪟 NUM_CTX:",
      LLM_NUM_CTX
    );


    console.log(
      "🌡️ TEMPERATURE:",
      LLM_TEMPERATURE
    );


    console.log(
      "⏱️ TIMEOUT:",
      LLM_TIMEOUT,
      "ms"
    );


    console.log(
      "🚀 Starting LLM stream..."
    );


    let response;


    try {

      response =
        await fetch(
          url,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",

              ...(OLLAMA_LLM_SECKEY
                ? {
                    "x-ollama-seckey":
                      OLLAMA_LLM_SECKEY
                  }
                : {})
            },

            body:
              JSON.stringify({
                model:
                  OLLAMA_LLM_MODEL,

                prompt,

                stream:
                  true,

                options: {
                  temperature:
                    LLM_TEMPERATURE,

                  num_ctx:
                    LLM_NUM_CTX
                }
              }),

            signal:
              controller.signal
          }
        );

    } finally {

      clearTimeout(
        timeoutId
      );
    }


    if (!response.ok) {

      const errorText =
        await response
          .text()
          .catch(
            () => ""
          );


      throw new Error(
        `LLM HTTP ${response.status}` +
        (
          errorText
            ? `: ${errorText.slice(0, 500)}`
            : ""
        )
      );
    }


    if (!response.body) {
      throw new Error(
        "LLM returned no stream body"
      );
    }


    // =================================================
    // 8. READ NDJSON STREAM
    //
    // /api/generate trả:
    //
    // {"response":"...","done":false}
    // {"response":"...","done":false}
    // ...
    // {"done":true,...}
    // =================================================

    const reader =
      response.body
        .getReader();


    const decoder =
      new TextDecoder();


    let buffer =
      "";


    let promptTokens =
      null;


    let outputTokens =
      null;


    let doneReason =
      null;


    while (
      !closed
    ) {

      const {
        done,
        value
      } =
        await reader.read();


      if (
        done ||
        closed
      ) {
        break;
      }


      buffer +=
        decoder.decode(
          value,
          {
            stream:
              true
          }
        );


      const lines =
        buffer.split("\n");


      buffer =
        lines.pop() ||
        "";


      for (
        const line of lines
      ) {

        const trimmed =
          line.trim();


        if (!trimmed) {
          continue;
        }


        let json;


        try {

          json =
            JSON.parse(
              trimmed
            );

        } catch {

          // Có thể là NDJSON chưa hoàn chỉnh.
          continue;
        }


        const token =
          typeof json?.response ===
          "string"
            ? json.response
            : "";


        if (token) {

          finalText +=
            token;


          sendSSE(
            res,
            {
              type:
                "content",

              content:
                token
            }
          );
        }


        if (json?.done) {

          promptTokens =
            json.prompt_eval_count ??
            null;


          outputTokens =
            json.eval_count ??
            null;


          doneReason =
            json.done_reason ??
            null;


          console.log(
            "\n========== LLM STREAM RESPONSE =========="
          );


          console.log(
            "✅ STREAM COMPLETE"
          );


          console.log(
            "⏱️ LATENCY:",
            Date.now() - start,
            "ms"
          );


          console.log(
            "🔢 PROMPT TOKENS:",
            promptTokens ??
            "N/A"
          );


          console.log(
            "🔢 OUTPUT TOKENS:",
            outputTokens ??
            "N/A"
          );


          console.log(
            "🏁 REASON:",
            doneReason ||
            "N/A"
          );


          console.log(
            "=========================================\n"
          );
        }
      }
    }


    // =================================================
    // 9. HANDLE REMAINING BUFFER
    // =================================================

    const remaining =
      buffer.trim();


    if (
      remaining &&
      !closed
    ) {

      try {

        const json =
          JSON.parse(
            remaining
          );


        const token =
          typeof json?.response ===
          "string"
            ? json.response
            : "";


        if (token) {

          finalText +=
            token;


          sendSSE(
            res,
            {
              type:
                "content",

              content:
                token
            }
          );
        }


        if (json?.done) {

          promptTokens =
            json.prompt_eval_count ??
            promptTokens;


          outputTokens =
            json.eval_count ??
            outputTokens;


          doneReason =
            json.done_reason ??
            doneReason;
        }

      } catch {
        // Ignore incomplete trailing NDJSON.
      }
    }


    // =================================================
    // 10. SAVE HISTORY
    // =================================================

    if (
      !closed &&
      finalText.trim()
    ) {

      try {

        addToHistory(
          req,
          question,
          finalText.trim()
        );

      } catch (err) {

        console.warn(
          "⚠️ Cannot save stream history:",
          err?.message ||
          err
        );
      }
    }


    // =================================================
    // 11. META
    // =================================================

    if (!closed) {

      sendSSE(
        res,
        {
          type:
            "meta",

          meta: {
            model_id:
              "qwen2.5-14b",

            model:
              OLLAMA_LLM_MODEL,

            response_time_ms:
              Date.now() - start,

            prompt_tokens:
              promptTokens,

            output_tokens:
              outputTokens,

            done_reason:
              doneReason
          }
        }
      );


      sendSSE(
        res,
        "[DONE]"
      );


      res.end();
    }


  } catch (err) {

    console.error(
      "❌ Scholar stream error:",
      err?.message ||
      err
    );


    // =================================================
    // 12. FALLBACK
    // =================================================

    if (
      !closed &&
      !res.writableEnded
    ) {

      const fallbackText =
        typeof result?.answer ===
          "string" &&
        result.answer.trim()
          ? result.answer.trim()
          : "";


      if (fallbackText) {

        sendSSE(
          res,
          {
            type:
              "content",

            content:
              fallbackText,

            fallback:
              true
          }
        );

      } else {

        sendSSE(
          res,
          {
            type:
              "error",

            error:
              err?.name ===
              "AbortError"
                ? "LLM timeout"
                : (
                    err?.message ||
                    "Internal error"
                  )
          }
        );
      }


      sendSSE(
        res,
        "[DONE]"
      );


      res.end();
    }


  } finally {

    // =================================================
    // 13. CLEANUP
    // =================================================

    if (heartbeat) {
      clearInterval(
        heartbeat
      );
    }


    if (
      controller &&
      !controller.signal.aborted
    ) {
      controller.abort();
    }
  }
}