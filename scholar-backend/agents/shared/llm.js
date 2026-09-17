// agents/shared/llm.js

import axios from "axios";


// =====================================================
// CONFIG
// =====================================================

const OLLAMA_LLM_BASE = (
  process.env.OLLAMA_LLM_BASE_URL ||
  "http://101.96.66.232:8037/ollama"
).replace(/\/+$/, "");


const OLLAMA_LLM_SECKEY =
  process.env.OLLAMA_LLM_SECKEY ||
  "research";


const DEFAULT_MODEL =
  process.env.OLLAMA_LLM_MODEL ||
  "qwen2.5:14b-instruct-ctx16k";


const DEFAULT_MODEL_ID =
  "qwen2.5-14b";


/**
 * Timeout phía Node.
 *
 * Postman đã xác nhận Qwen2.5 14B có thể trả một
 * non-streaming response trong khoảng 9 giây.
 *
 * 60 giây vẫn được giữ để có đủ dư địa cho prompt dài hơn.
 */
const LLM_TIMEOUT =
  Number(process.env.LLM_TIMEOUT_MS) ||
  60000;


// =====================================================
// MODEL MAP
// =====================================================

export const modelMap = {
  "qwen2.5-14b": {
    provider: "ollama",
    model: DEFAULT_MODEL
  }
};


// =====================================================
// UTILS
// =====================================================

function normalizePrompt(prompt) {
  if (typeof prompt !== "string") {
    return "";
  }

  return prompt.trim();
}


function getPromptStats(prompt) {
  const chars =
    prompt?.length || 0;

  const bytes =
    Buffer.byteLength(
      prompt || "",
      "utf8"
    );

  return {
    chars,
    bytes,
    kb:
      (bytes / 1024)
        .toFixed(2)
  };
}


function nsToMs(value) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  ) {
    return null;
  }

  return Number(value) / 1_000_000;
}


// =====================================================
// LOW LEVEL OLLAMA CALL
// =====================================================

async function callOllamaRaw(
  prompt,
  model
) {

  const start =
    Date.now();


  const finalPrompt =
    normalizePrompt(prompt);


  if (!finalPrompt) {
    throw new Error(
      "LLM prompt is empty"
    );
  }


  const finalModel =
    model ||
    DEFAULT_MODEL;


  const url =
    `${OLLAMA_LLM_BASE}/api/generate`;


  const stats =
    getPromptStats(
      finalPrompt
    );


  // ===================================================
  // PAYLOAD
  // ===================================================
  //
  // QUAN TRỌNG:
  //
  // Ollama /api/generate mặc định stream=true.
  //
  // Nhưng Scholar Agent hiện cần một JSON response hoàn
  // chỉnh để đọc:
  //
  //     response.data.response
  //
  // Vì vậy BẮT BUỘC gửi stream:false.
  //
  // Đây cũng chính là request đã được kiểm tra thành công
  // trực tiếp với Ollama/Postman.
  //
  // Tạm thời KHÔNG thêm:
  //
  // - temperature
  // - num_ctx
  // - num_predict
  //
  // để request Node giống request Postman nhất có thể.
  // ===================================================

  const payload = {
    model:
      finalModel,

    prompt:
      finalPrompt,

    stream:
      false
  };


  // ===================================================
  // DEBUG REQUEST
  // ===================================================

  console.log(
    "\n========== LLM REQUEST =========="
  );

  console.log(
    "🌐 URL:",
    url
  );

  console.log(
    "🧠 MODEL:",
    finalModel
  );

  console.log(
    "📏 PROMPT CHARS:",
    stats.chars
  );

  console.log(
    "📦 PROMPT SIZE:",
    `${stats.kb} KB`
  );

  console.log(
    "⏱️ TIMEOUT:",
    `${LLM_TIMEOUT} ms`
  );

  console.log(
    "🔌 PROXY:",
    "disabled"
  );

  console.log(
    "📤 PAYLOAD MODE:",
    "non-streaming"
  );

  console.log(
    "🌊 STREAM:",
    payload.stream
  );

  console.log(
    "🚀 Sending request to LLM..."
  );

  console.log(
    "=================================\n"
  );


  try {

    // =================================================
    // HTTP REQUEST
    // =================================================

    const res =
      await axios.post(
        url,
        payload,
        {
          headers: {
            "Content-Type":
              "application/json",

            "Accept":
              "application/json",

            "x-ollama-seckey":
              OLLAMA_LLM_SECKEY
          },


          /**
           * Không sử dụng HTTP_PROXY / HTTPS_PROXY
           * của environment.
           */
          proxy:
            false,


          /**
           * Axios phải parse response thành JSON object.
           */
          responseType:
            "json",


          timeout:
            LLM_TIMEOUT,


          maxContentLength:
            Infinity,


          maxBodyLength:
            Infinity,


          /**
           * Không tự coi HTTP >= 400 là response hợp lệ.
           */
          validateStatus:
            status =>
              status >= 200 &&
              status < 300
        }
      );


    // =================================================
    // RESPONSE
    // =================================================

    const latency =
      Date.now() - start;


    const data =
      res?.data &&
      typeof res.data === "object"
        ? res.data
        : {};


    const content =
      typeof data.response === "string"
        ? data.response
        : "";


    console.log(
      "\n========== LLM RESPONSE =========="
    );

    console.log(
      "✅ RESPONSE RECEIVED"
    );

    console.log(
      "📡 HTTP STATUS:",
      res.status
    );

    console.log(
      "⏱️ LATENCY:",
      `${latency} ms`
    );

    console.log(
      "📥 RESPONSE CHARS:",
      content.length
    );

    console.log(
      "🔢 PROMPT TOKENS:",
      data.prompt_eval_count ??
      "N/A"
    );

    console.log(
      "🔢 OUTPUT TOKENS:",
      data.eval_count ??
      "N/A"
    );

    console.log(
      "🏁 DONE:",
      data.done ??
      "N/A"
    );

    console.log(
      "🏁 REASON:",
      data.done_reason ??
      "N/A"
    );


    const totalDurationMs =
      nsToMs(
        data.total_duration
      );

    const loadDurationMs =
      nsToMs(
        data.load_duration
      );

    const promptEvalDurationMs =
      nsToMs(
        data.prompt_eval_duration
      );

    const evalDurationMs =
      nsToMs(
        data.eval_duration
      );


    console.log(
      "⏱️ TOTAL DURATION:",
      totalDurationMs !== null
        ? `${totalDurationMs.toFixed(2)} ms`
        : "N/A"
    );

    console.log(
      "⏱️ LOAD DURATION:",
      loadDurationMs !== null
        ? `${loadDurationMs.toFixed(2)} ms`
        : "N/A"
    );

    console.log(
      "⏱️ PROMPT EVAL DURATION:",
      promptEvalDurationMs !== null
        ? `${promptEvalDurationMs.toFixed(2)} ms`
        : "N/A"
    );

    console.log(
      "⏱️ EVAL DURATION:",
      evalDurationMs !== null
        ? `${evalDurationMs.toFixed(2)} ms`
        : "N/A"
    );

    console.log(
      "==================================\n"
    );


    // =================================================
    // VALIDATE RESPONSE
    // =================================================

    if (!content.trim()) {
      console.warn(
        "⚠️ LLM returned empty response"
      );
    }


    if (
      data.done === false
    ) {
      console.warn(
        "⚠️ Ollama returned done=false even though stream=false"
      );
    }


    return {
      content,

      latency,

      model:
        data.model ||
        finalModel,

      done:
        data.done ??
        null,

      doneReason:
        data.done_reason ||
        null,

      promptTokens:
        data.prompt_eval_count ??
        null,

      outputTokens:
        data.eval_count ??
        null,

      totalDuration:
        data.total_duration ??
        null,

      loadDuration:
        data.load_duration ??
        null,

      promptEvalDuration:
        data.prompt_eval_duration ??
        null,

      evalDuration:
        data.eval_duration ??
        null
    };


  } catch (err) {

    // =================================================
    // ERROR
    // =================================================

    const latency =
      Date.now() - start;


    console.error(
      "\n========== LLM ERROR =========="
    );

    console.error(
      "❌ FAILED AFTER:",
      `${latency} ms`
    );

    console.error(
      "❌ URL:",
      url
    );

    console.error(
      "❌ MODEL:",
      finalModel
    );

    console.error(
      "❌ PROMPT CHARS:",
      stats.chars
    );

    console.error(
      "❌ PROMPT SIZE:",
      `${stats.kb} KB`
    );

    console.error(
      "❌ STREAM:",
      false
    );

    console.error(
      "❌ STATUS:",
      err.response?.status ??
      "(no response)"
    );

    console.error(
      "❌ CODE:",
      err.code ||
      "(none)"
    );

    console.error(
      "❌ MESSAGE:",
      err.message ||
      "(no message)"
    );


    if (err.response?.data) {
      console.error(
        "❌ RESPONSE DATA:",
        err.response.data
      );
    }


    if (err.cause) {
      console.error(
        "❌ CAUSE:",
        err.cause
      );
    }


    console.error(
      "===============================\n"
    );


    const serverError =
      typeof err.response?.data?.error ===
      "string"
        ? err.response.data.error
        : null;


    throw new Error(
      serverError ||
      err.message ||
      "Ollama request failed"
    );
  }
}


// =====================================================
// SAFE JSON PARSE
// =====================================================

function safeJSONParse(text) {

  if (
    typeof text !== "string" ||
    !text.trim()
  ) {
    return null;
  }


  const clean =
    text
      .trim()

      .replace(
        /^```json\s*/i,
        ""
      )

      .replace(
        /^```\s*/,
        ""
      )

      .replace(
        /\s*```$/,
        ""
      )

      .trim();


  // ===================================================
  // DIRECT JSON
  // ===================================================

  try {
    return JSON.parse(
      clean
    );

  } catch {
    // tiếp tục fallback
  }


  // ===================================================
  // EXTRACT JSON OBJECT / ARRAY
  // ===================================================

  const match =
    clean.match(
      /\{[\s\S]*\}|\[[\s\S]*\]/
    );


  if (!match) {
    return null;
  }


  try {
    return JSON.parse(
      match[0]
    );

  } catch {
    return null;
  }
}


// =====================================================
// GENERIC LLM CALL
// =====================================================

export async function callLLM(
  prompt,
  model_id = DEFAULT_MODEL_ID
) {

  // ===================================================
  // MODEL RESOLUTION
  // ===================================================

  const finalModelId =
    modelMap[model_id]
      ? model_id
      : DEFAULT_MODEL_ID;


  if (
    finalModelId !== model_id
  ) {

    console.warn(
      `⚠️ Unknown model_id=${model_id}, fallback → ${finalModelId}`
    );
  }


  const info =
    modelMap[
      finalModelId
    ];


  const model =
    info?.model ||
    DEFAULT_MODEL;


  console.log(
    `⚡ callLLM → model_id=${finalModelId} | model=${model}`
  );


  try {

    const res =
      await callOllamaRaw(
        prompt,
        model
      );


    return {
      provider:
        "ollama",

      model_id:
        finalModelId,

      model:
        res.model ||
        model,

      latency:
        res.latency,

      answer:
        res.content ||
        "",

      usage: {
        prompt_tokens:
          res.promptTokens,

        output_tokens:
          res.outputTokens
      },

      done:
        res.done,

      done_reason:
        res.doneReason
    };


  } catch (err) {

    console.error(
      "❌ LLM error:",
      err.message
    );


    /**
     * Không làm crash Scholar/Fund Agent.
     *
     * Scholar/Fund Agent phía trên có thể sử dụng
     * deterministic fallback nếu LLM gặp lỗi.
     */
    return {
      provider:
        "ollama",

      model_id:
        finalModelId,

      model,

      latency:
        null,

      answer:
        "",

      usage: {
        prompt_tokens:
          null,

        output_tokens:
          null
      },

      done:
        false,

      done_reason:
        null,

      error:
        err.message
    };
  }
}


// =====================================================
// JSON MODE
// =====================================================

export async function callLLMJson(
  prompt,
  model_id = DEFAULT_MODEL_ID
) {

  const strictPrompt = `
You MUST return valid JSON only.

Rules:
- Return JSON only
- No explanation
- No markdown
- No code fences
- Do not include text before or after JSON

${prompt}
`.trim();


  const res =
    await callLLM(
      strictPrompt,
      model_id
    );


  if (!res?.answer) {

    throw new Error(
      res?.error ||
      "LLM returned empty response"
    );
  }


  const parsed =
    safeJSONParse(
      res.answer
    );


  if (!parsed) {

    console.error(
      "❌ JSON parse failed. Raw:",
      res.answer
    );


    throw new Error(
      "LLM JSON parse failed"
    );
  }


  return parsed;
}


// =====================================================
// QUERY REWRITE
// =====================================================

export async function rewriteQueryLLM(
  question,
  model_id = DEFAULT_MODEL_ID
) {

  if (
    !question ||
    !String(question).trim()
  ) {
    return [];
  }


  const originalQuestion =
    String(question)
      .trim();


  const prompt = `
Rewrite the following user query into 3 optimized academic search queries.

The search database contains:
- scientific conferences
- academic journals
- research topics

Requirements:
- Preserve the user's research intent
- Preserve explicit country/location constraints
- Preserve explicit journal quartile constraints
- Use concise academic terminology
- Prefer English academic keywords when appropriate for journal search
- Do not invent new constraints

User question:
"${originalQuestion}"

Return exactly this JSON structure:

{
  "queries": [
    "query 1",
    "query 2",
    "query 3"
  ]
}
`.trim();


  try {

    const data =
      await callLLMJson(
        prompt,
        model_id
      );


    const queries =
      Array.isArray(
        data?.queries
      )
        ? data.queries
            .filter(
              q =>
                typeof q ===
                  "string" &&
                q.trim()
            )
            .map(
              q =>
                q.trim()
            )
            .slice(
              0,
              3
            )
        : [];


    return queries.length
      ? queries
      : [
          originalQuestion
        ];


  } catch (err) {

    console.warn(
      "⚠️ rewrite fallback:",
      err.message
    );


    return [
      originalQuestion
    ];
  }
}


// =====================================================
// RERANK
// =====================================================

export async function rerankLLM(
  query,
  items,
  model_id = DEFAULT_MODEL_ID
) {

  if (
    !Array.isArray(items) ||
    !items.length
  ) {
    return items || [];
  }


  /**
   * Chỉ đưa tối đa 15 candidate vào LLM.
   */
  const candidates =
    items.slice(
      0,
      15
    );


  const itemText =
    candidates
      .map(
        (it, i) => {

          const title =
            it?.title ||
            it?.name ||
            it?.acronym ||
            "Untitled";


          const topics =
            Array.isArray(
              it?.topics
            )
              ? it.topics.join(
                  ", "
                )

              : Array.isArray(
                  it?.areas
                )
                ? it.areas.join(
                    ", "
                  )

                : Array.isArray(
                    it?.categories
                  )
                  ? it.categories.join(
                      ", "
                    )

                  : Array.isArray(
                      it?.fields
                    )
                    ? it.fields.join(
                        ", "
                      )

                    : "";


          return (
            `[${i}] ${title}` +
            (
              topics
                ? ` | ${topics}`
                : ""
            )
          );
        }
      )
      .join(
        "\n"
      );


  const prompt = `
You are an academic search reranking system.

Rank the candidate items by relevance to the user's query.

User query:
"${query}"

Candidates:
${itemText}

Return ONLY a JSON array containing candidate indices
from most relevant to least relevant.

Example:
[2, 0, 1]
`.trim();


  try {

    const order =
      await callLLMJson(
        prompt,
        model_id
      );


    if (
      !Array.isArray(order)
    ) {
      return items;
    }


    const used =
      new Set();


    const reranked =
      order
        .filter(
          index =>
            Number.isInteger(
              index
            ) &&
            index >= 0 &&
            index <
              candidates.length &&
            !used.has(
              index
            )
        )
        .map(
          index => {

            used.add(
              index
            );

            return candidates[
              index
            ];
          }
        );


    /**
     * Nếu LLM bỏ sót candidate,
     * giữ lại theo thứ tự ranking cũ.
     */
    candidates.forEach(
      (item, index) => {

        if (
          !used.has(index)
        ) {
          reranked.push(
            item
          );
        }
      }
    );


    /**
     * Nếu đầu vào > 15 items,
     * giữ nguyên phần còn lại.
     */
    if (
      items.length >
      candidates.length
    ) {

      reranked.push(
        ...items.slice(
          candidates.length
        )
      );
    }


    return reranked;


  } catch (err) {

    console.warn(
      "⚠️ rerank fallback:",
      err.message
    );


    return items;
  }
}