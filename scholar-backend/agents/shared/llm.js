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
  process.env.OLLAMA_LLM_SECKEY || "";


const DEFAULT_MODEL =
  process.env.OLLAMA_LLM_MODEL ||
  process.env.OLLAMA_MODEL ||
  "qwen2.5:14b-instruct-ctx16k";


const DEFAULT_MODEL_ID =
  "qwen2.5-14b";


const LLM_TIMEOUT =
  Number(process.env.LLM_TIMEOUT_MS) ||
  120000;


const LLM_NUM_CTX =
  Number(process.env.LLM_NUM_CTX) ||
  16384;


const LLM_TEMPERATURE =
  Number(process.env.LLM_TEMPERATURE) ||
  0.2;


// =====================================================
// MODEL MAP
// =====================================================

export const modelMap = {
  "qwen2.5-14b": {
    provider: "ollama",
    model: "qwen2.5:14b-instruct-ctx16k"
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
      (bytes / 1024).toFixed(2)
  };
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
    model || DEFAULT_MODEL;


  const url =
    `${OLLAMA_LLM_BASE}/api/generate`;


  const stats =
    getPromptStats(finalPrompt);


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
    "🪟 NUM_CTX:",
    LLM_NUM_CTX
  );

  console.log(
    "🌡️ TEMPERATURE:",
    LLM_TEMPERATURE
  );

  console.log(
    "⏱️ TIMEOUT:",
    `${LLM_TIMEOUT} ms`
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

        {
          model:
            finalModel,

          prompt:
            finalPrompt,

          stream:
            false,

          options: {
            temperature:
              LLM_TEMPERATURE,

            num_ctx:
              LLM_NUM_CTX
          }
        },

        {
          headers: {
            "Content-Type":
              "application/json",

            "x-ollama-seckey":
              OLLAMA_LLM_SECKEY
          },

          timeout:
            LLM_TIMEOUT,

          // Không giới hạn response body mặc định của axios
          maxContentLength:
            Infinity,

          maxBodyLength:
            Infinity
        }
      );


    // =================================================
    // RESPONSE
    // =================================================

    const latency =
      Date.now() - start;


    const content =
      typeof res.data?.response === "string"
        ? res.data.response
        : "";


    console.log(
      "\n========== LLM RESPONSE =========="
    );

    console.log(
      "✅ RESPONSE RECEIVED"
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
      res.data?.prompt_eval_count ??
      "N/A"
    );

    console.log(
      "🔢 OUTPUT TOKENS:",
      res.data?.eval_count ??
      "N/A"
    );

    console.log(
      "🏁 DONE:",
      res.data?.done ??
      "N/A"
    );

    console.log(
      "🏁 REASON:",
      res.data?.done_reason ??
      "N/A"
    );

    console.log(
      "⏱️ TOTAL DURATION:",
      res.data?.total_duration ??
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
        res.data?.model ||
        finalModel,

      done:
        res.data?.done ??
        null,

      doneReason:
        res.data?.done_reason ||
        null,

      promptTokens:
        res.data?.prompt_eval_count ??
        null,

      outputTokens:
        res.data?.eval_count ??
        null,

      totalDuration:
        res.data?.total_duration ??
        null,

      loadDuration:
        res.data?.load_duration ??
        null,

      promptEvalDuration:
        res.data?.prompt_eval_duration ??
        null,

      evalDuration:
        res.data?.eval_duration ??
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
      "❌ STATUS:",
      err.response?.status ||
      "(no response)"
    );

    console.error(
      "❌ CODE:",
      err.code ||
      "(none)"
    );

    console.error(
      "❌ MESSAGE:",
      err.message
    );


    if (err.response?.data) {
      console.error(
        "❌ RESPONSE DATA:",
        err.response.data
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

      // loại bỏ ```json ... ```
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
    return JSON.parse(clean);

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
    modelMap[finalModelId];


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
        res.content || "",

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


    // Không crash toàn Scholar Agent.
    // scholar.service.js sẽ fallback sang
    // deterministic result.answer.
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
"${String(question).trim()}"

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
                typeof q === "string" &&
                q.trim()
            )
            .map(
              q => q.trim()
            )
            .slice(0, 3)
        : [];


    return queries.length
      ? queries
      : [question];


  } catch (err) {

    console.warn(
      "⚠️ rewrite fallback:",
      err.message
    );


    return [
      String(question).trim()
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


  // Giới hạn để tránh prompt rerank quá lớn
  const candidates =
    items.slice(0, 15);


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
            Array.isArray(it?.topics)
              ? it.topics.join(", ")
              : Array.isArray(it?.areas)
                ? it.areas.join(", ")
                : Array.isArray(it?.categories)
                  ? it.categories.join(", ")
                  : Array.isArray(it?.fields)
                    ? it.fields.join(", ")
                    : "";


          return (
            `[${i}] ${title}` +
            (topics
              ? ` | ${topics}`
              : "")
          );
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
      order
        .filter(
          index =>
            Number.isInteger(index) &&
            index >= 0 &&
            index < candidates.length &&
            !used.has(index)
        )
        .map(index => {
          used.add(index);

          return candidates[index];
        });


    // Nếu LLM bỏ sót candidate,
    // giữ lại theo thứ tự ranking cũ.
    candidates.forEach(
      (item, index) => {
        if (!used.has(index)) {
          reranked.push(item);
        }
      }
    );


    // Nếu đầu vào > 15 items,
    // giữ nguyên phần còn lại.
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