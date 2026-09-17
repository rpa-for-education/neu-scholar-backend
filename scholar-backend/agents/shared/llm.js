// agents/shared/llm.js

// =====================================================
// CONFIG
// =====================================================

const OLLAMA_LLM_BASE = (
  process.env.OLLAMA_LLM_BASE_URL ||
  "http://101.96.66.232:8037/ollama"
).replace(/\/+$/, "");


// Ưu tiên ENV.
// Nếu ENV chưa cấu hình thì fallback sang secret hiện tại
// để backend vẫn có thể hoạt động.
const OLLAMA_LLM_SECKEY =
  process.env.OLLAMA_LLM_SECKEY ||
  "research";


const DEFAULT_MODEL =
  process.env.OLLAMA_LLM_MODEL ||
  "qwen2.5:14b-instruct-ctx16k";


const DEFAULT_MODEL_ID =
  "qwen2.5-14b";


const LLM_TIMEOUT =
  Number(
    process.env.LLM_TIMEOUT_MS
  ) || 60000;


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
  return typeof prompt === "string"
    ? prompt.trim()
    : "";
}


function promptStats(prompt) {
  const chars =
    prompt.length;

  const bytes =
    Buffer.byteLength(
      prompt,
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


  // ---------------------------------------------------
  // JSON trực tiếp
  // ---------------------------------------------------

  try {
    return JSON.parse(clean);
  } catch {
    // tiếp tục fallback
  }


  // ---------------------------------------------------
  // Tìm JSON object hoặc array trong response
  // ---------------------------------------------------

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


function getErrorMessage(
  data,
  fallback
) {
  if (
    data &&
    typeof data === "object" &&
    typeof data.error === "string" &&
    data.error.trim()
  ) {
    return data.error;
  }

  return fallback;
}


// =====================================================
// LOW-LEVEL OLLAMA CALL
//
// Native fetch.
//
// Request giữ gần nhất với request Ollama
// đã test thành công:
// - /api/generate
// - stream:false
// - không temperature
// - không num_ctx
// - không num_predict
// =====================================================

async function callOllamaRaw(
  prompt,
  model
) {
  const finalPrompt =
    normalizePrompt(prompt);


  if (!finalPrompt) {
    throw new Error(
      "LLM prompt is empty"
    );
  }


  /*
   * Với cấu hình hiện tại, biến này luôn có giá trị:
   *
   * ENV nếu có
   * hoặc fallback "research".
   *
   * Giữ validation để tránh request sai nếu cấu hình
   * bị thay đổi trong tương lai.
   */
  if (!OLLAMA_LLM_SECKEY) {
    throw new Error(
      "OLLAMA_LLM_SECKEY is not configured"
    );
  }


  const finalModel =
    model ||
    DEFAULT_MODEL;


  const url =
    `${OLLAMA_LLM_BASE}/api/generate`;


  const stats =
    promptStats(
      finalPrompt
    );


  const payload = {
    model:
      finalModel,

    prompt:
      finalPrompt,

    stream:
      false
  };


  const start =
    Date.now();


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
    "🔐 SECKEY:",
    "configured"
  );

  console.log(
    "🚚 TRANSPORT: native fetch"
  );

  console.log(
    "🌊 STREAM: false"
  );

  console.log(
    "🚀 Sending request to LLM..."
  );

  console.log(
    "=================================\n"
  );


  try {

    const response =
      await fetch(
        url,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            "Accept":
              "application/json",

            "x-ollama-seckey":
              OLLAMA_LLM_SECKEY
          },

          body:
            JSON.stringify(
              payload
            ),

          signal:
            AbortSignal.timeout(
              LLM_TIMEOUT
            )
        }
      );


    const latency =
      Date.now() -
      start;


    /*
     * Đọc text trước để xử lý được cả trường hợp
     * server trả body không phải JSON.
     */
    const raw =
      await response.text();


    let data = null;


    try {

      data =
        raw
          ? JSON.parse(raw)
          : {};

    } catch {

      throw new Error(
        `Ollama returned invalid JSON (HTTP ${response.status})`
      );
    }


    if (!response.ok) {

      throw new Error(
        getErrorMessage(
          data,
          `Ollama HTTP ${response.status}`
        )
      );
    }


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
      response.status
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

    console.log(
      "==================================\n"
    );


    if (!content.trim()) {

      console.warn(
        "⚠️ LLM returned empty response"
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
        data.done_reason ??
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

    const latency =
      Date.now() -
      start;


    const timeout =
      err?.name === "TimeoutError" ||
      err?.name === "AbortError";


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
      "❌ TYPE:",
      timeout
        ? "TIMEOUT"
        : err?.name
    );

    console.error(
      "❌ MESSAGE:",
      err?.message ||
      "Unknown error"
    );


    if (err?.cause) {

      console.error(
        "❌ CAUSE:",
        err.cause
      );
    }


    console.error(
      "===============================\n"
    );


    if (timeout) {

      throw new Error(
        `Ollama timeout after ${LLM_TIMEOUT}ms`
      );
    }


    throw new Error(
      err?.message ||
      "Ollama request failed"
    );
  }
}


// =====================================================
// GENERIC LLM CALL
//
// Contract:
//
// {
//   provider,
//   model_id,
//   model,
//   latency,
//   answer,
//   usage,
//   done,
//   done_reason,
//   error?
// }
// =====================================================

export async function callLLM(
  prompt,
  model_id = DEFAULT_MODEL_ID
) {
  const finalModelId =
    modelMap[model_id]
      ? model_id
      : DEFAULT_MODEL_ID;


  if (
    finalModelId !==
    model_id
  ) {

    console.warn(
      `⚠️ Unknown model_id=${model_id}, ` +
      `fallback → ${finalModelId}`
    );
  }


  const model =
    modelMap[
      finalModelId
    ]?.model ||
    DEFAULT_MODEL;


  console.log(
    `⚡ callLLM → model_id=${finalModelId} | model=${model}`
  );


  try {

    const result =
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
        result.model ||
        model,

      latency:
        result.latency,

      answer:
        result.content ||
        "",

      usage: {

        prompt_tokens:
          result.promptTokens,

        output_tokens:
          result.outputTokens
      },

      done:
        result.done,

      done_reason:
        result.doneReason
    };


  } catch (err) {

    console.error(
      "❌ LLM error:",
      err.message
    );


    /*
     * DETERMINISTIC FALLBACK CONTRACT
     *
     * Không throw ra ngoài.
     *
     * Scholar/Fund service nhận answer=""
     * và có thể sử dụng deterministic answer.
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


  const result =
    await callLLM(
      strictPrompt,
      model_id
    );


  if (!result?.answer) {

    throw new Error(
      result?.error ||
      "LLM returned empty response"
    );
  }


  const parsed =
    safeJSONParse(
      result.answer
    );


  if (
    parsed === null
  ) {

    console.error(
      "❌ JSON parse failed. Raw:",
      result.answer
    );


    throw new Error(
      "LLM JSON parse failed"
    );
  }


  return parsed;
}


// =====================================================
// QUERY REWRITE
//
// Đây là query expansion cũ.
//
// LƯU Ý:
// Contextual rewrite hiện nằm ở:
// agents/shared/queryRewriter.js
//
// Giữ export này để không phá các module cũ
// vẫn đang import rewriteQueryLLM.
// =====================================================

export async function rewriteQueryLLM(
  question,
  model_id = DEFAULT_MODEL_ID
) {
  const originalQuestion =
    String(
      question ||
      ""
    ).trim();


  if (!originalQuestion) {
    return [];
  }


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


  const candidates =
    items.slice(
      0,
      15
    );


  const itemText =
    candidates
      .map(
        (item, index) => {

          const title =
            item?.title ||
            item?.name ||
            item?.acronym ||
            "Untitled";


          let topics = "";


          if (
            Array.isArray(
              item?.topics
            )
          ) {

            topics =
              item.topics.join(
                ", "
              );

          } else if (
            Array.isArray(
              item?.areas
            )
          ) {

            topics =
              item.areas.join(
                ", "
              );

          } else if (
            Array.isArray(
              item?.categories
            )
          ) {

            topics =
              item.categories.join(
                ", "
              );

          } else if (
            Array.isArray(
              item?.fields
            )
          ) {

            topics =
              item.fields.join(
                ", "
              );
          }


          return topics
            ? `[${index}] ${title} | ${topics}`
            : `[${index}] ${title}`;
        }
      )
      .join("\n");


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
      [];


    for (
      const index
      of order
    ) {

      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index <
          candidates.length &&
        !used.has(index)
      ) {

        used.add(index);

        reranked.push(
          candidates[index]
        );
      }
    }


    /*
     * Candidate bị LLM bỏ sót:
     * giữ ranking ban đầu.
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


    /*
     * Nếu input > 15:
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