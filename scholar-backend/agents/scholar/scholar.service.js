// agents/scholar/scholar.service.js

import { runAgent } from "./scholar.agent.js";
import { addToHistory } from "../../middlewares/session.js";

import {
  normalizeHistory
} from "../shared/memory.js";

import {
  buildLLMContext
} from "../shared/context.js";

import {
  buildScholarPrompt
} from "./scholar.prompt.js";

import {
  callLLM
} from "../shared/llm.js";


// =====================================================
// SCHOLAR SERVICE
// =====================================================

export async function runScholarAgent(
  req,
  question,
  model_id,
  topk,
  history = []
) {
  const start = Date.now();

  try {

    // =====================================================
    // 1. MEMORY / CONTEXT
    // =====================================================

    const normalizedHistory =
      normalizeHistory(history);


    const llmContext =
      buildLLMContext(req);


    // History do Portal truyền vào route là nguồn chính.
    // Normalize lại trước khi đưa vào prompt.
    llmContext.history =
      normalizedHistory;


    console.log(
      "\n========== SCHOLAR AGENT =========="
    );

    console.log(
      "🧠 HISTORY ITEMS:",
      llmContext.history.length
    );

    console.log(
      "👤 PROFILE:",
      llmContext.profile?.full_name ||
      "(none)"
    );

    console.log(
      "📌 PROJECT:",
      llmContext.project?.name ||
      "(none)"
    );

    console.log(
      "📄 DOCUMENTS:",
      llmContext.docs.length
    );

    console.log(
      "🔎 SEARCH QUESTION:",
      question
    );

    console.log(
      "🤖 REQUESTED MODEL:",
      model_id ||
      "(default)"
    );

    console.log(
      "===================================\n"
    );


    // =====================================================
    // 2. SCHOLAR SEARCH
    //
    // question
    //    ↓
    // scholar.agent.js
    //    ↓
    // scholar.search.js
    //    ↓
    // embedding.js
    //    ↓
    // Qdrant
    // =====================================================

    const result =
      await runAgent(
        question,
        topk
      );


    const conferences =
      Array.isArray(result?.conferences)
        ? result.conferences
        : [];


    const journals =
      Array.isArray(result?.journals)
        ? result.journals
        : [];


    console.log(
      "📊 SEARCH:",
      conferences.length,
      journals.length
    );


    // =====================================================
    // 3. URL HELPERS
    // =====================================================

    function buildConferenceUrl(c) {
      return (
        c?.cfp_link ||
        c?.url ||
        c?.link ||
        c?.website ||
        ""
      );
    }


    function buildJournalUrl(j) {
      return (
        j?.scimago_link ||
        j?.url ||
        ""
      );
    }


    // =====================================================
    // 4. SAFE DATE
    // =====================================================

    function safeTime(dateStr) {

      if (!dateStr) {
        return null;
      }


      const time =
        new Date(dateStr)
          .getTime();


      return Number.isFinite(time)
        ? time
        : null;
    }


    // =====================================================
    // 5. CONFERENCE STATUS
    // =====================================================

    function getConferenceStatus(c) {

      const now =
        Date.now();


      const deadline =
        safeTime(c?.deadline);


      const start =
        safeTime(c?.start_date);


      // -----------------------------------------
      // Có deadline
      // -----------------------------------------

      if (deadline !== null) {

        const diffDays =
          (deadline - now) /
          (1000 * 60 * 60 * 24);


        if (diffDays > 30) {
          return "submission_open";
        }


        if (diffDays > 0) {
          return "submission_soon";
        }


        // Deadline đã qua
        if (start !== null) {

          if (start > now) {
            return "upcoming_event";
          }


          return "past_event";
        }


        return "submission_closed";
      }


      // -----------------------------------------
      // Không có deadline nhưng có event date
      // -----------------------------------------

      if (start !== null) {

        if (start > now) {
          return "upcoming_event";
        }


        return "past_event";
      }


      return "unknown";
    }


    // =====================================================
    // 6. BUILD SOURCES
    // =====================================================

    const sources = [

      // -------------------------------------------------
      // Conferences
      // -------------------------------------------------

      ...conferences.map(
        (c, i) => ({

          id:
            `C${i + 1}`,

          type:
            "conference",

          title:
            c?.name ||
            c?.title ||
            c?.acronym ||
            "Untitled conference",

          url:
            buildConferenceUrl(c),

          metadata: {

            ...(c?.country && {
              country:
                c.country
            }),

            ...(c?.city && {
              city:
                c.city
            }),

            ...(c?.deadline && {
              deadline:
                c.deadline
            }),

            ...(c?.start_date && {
              start_date:
                c.start_date
            }),

            conference_status:
              getConferenceStatus(c),

            ...(
              Array.isArray(c?.fields) &&
              c.fields.length
                ? {
                    fields:
                      c.fields
                  }
                : {}
            ),

            ...(
              Array.isArray(c?.topics) &&
              c.topics.length
                ? {
                    topics:
                      c.topics
                  }
                : {}
            ),

            score:
              c?.finalScore ??
              c?.score ??
              0
          }
        })
      ),


      // -------------------------------------------------
      // Journals
      // -------------------------------------------------

      ...journals.map(
        (j, i) => ({

          id:
            `J${i + 1}`,

          type:
            "journal",

          title:
            j?.title ||
            "Untitled journal",

          url:
            buildJournalUrl(j),

          metadata: {

            ...(j?.sjr_best_quartile && {
              quartile:
                j.sjr_best_quartile
            }),

            ...(j?.publisher && {
              publisher:
                j.publisher
            }),

            ...(j?.country && {
              country:
                j.country
            }),

            ...(
              Array.isArray(j?.fields) &&
              j.fields.length
                ? {
                    fields:
                      j.fields
                  }
                : {}
            ),

            ...(
              Array.isArray(j?.categories) &&
              j.categories.length
                ? {
                    categories:
                      j.categories
                  }
                : {}
            ),

            ...(
              Array.isArray(j?.areas) &&
              j.areas.length
                ? {
                    areas:
                      j.areas
                  }
                : {}
            ),

            score:
              j?.finalScore ??
              j?.score ??
              0
          }
        })
      )
    ];


    console.log(
      "📦 SOURCES:",
      sources.length
    );


    // =====================================================
    // 7. BUILD LLM PROMPT
    //
    // Bao gồm:
    // - user profile
    // - project
    // - documents
    // - conversation history
    // - conference results
    // - journal results
    // - current question
    // =====================================================

    const prompt =
      buildScholarPrompt(
        question,
        conferences,
        journals,
        llmContext
      );


    console.log(
      "📝 PROMPT READY:",
      `${prompt.length} chars`
    );


    // =====================================================
    // 8. CALL LLM
    // =====================================================

    console.log(
      "🤖 CALLING LLM..."
    );


    const llmResult =
      await callLLM(
        prompt,
        model_id
      );


    console.log(
      "🤖 LLM MODEL:",
      llmResult?.model ||
      "(unknown)"
    );


    console.log(
      "⏱️ LLM LATENCY:",
      llmResult?.latency ??
      "N/A",
      "ms"
    );


    if (
      llmResult?.usage
        ?.prompt_tokens !== null &&
      llmResult?.usage
        ?.prompt_tokens !== undefined
    ) {
      console.log(
        "🔢 LLM PROMPT TOKENS:",
        llmResult.usage.prompt_tokens
      );
    }


    if (
      llmResult?.usage
        ?.output_tokens !== null &&
      llmResult?.usage
        ?.output_tokens !== undefined
    ) {
      console.log(
        "🔢 LLM OUTPUT TOKENS:",
        llmResult.usage.output_tokens
      );
    }


    if (llmResult?.error) {
      console.warn(
        "⚠️ LLM ERROR:",
        llmResult.error
      );
    }


    // =====================================================
    // 9. FINAL ANSWER
    //
    // Ưu tiên:
    //
    // 1. LLM answer
    // 2. deterministic answer từ runAgent
    // 3. fallback tự tạo
    // =====================================================

    let answer =
      typeof llmResult?.answer === "string"
        ? llmResult.answer.trim()
        : "";


    // =====================================================
    // 10. FALLBACK TO DETERMINISTIC ANSWER
    // =====================================================

    if (!answer) {

      answer =
        typeof result?.answer === "string"
          ? result.answer.trim()
          : "";


      if (answer) {
        console.warn(
          "⚠️ Using deterministic Scholar answer because LLM returned no answer."
        );
      }
    }


    // =====================================================
    // 11. FINAL FALLBACK
    // =====================================================

    if (!answer) {

      const total =
        conferences.length +
        journals.length;


      if (total === 0) {

        answer =
          "Không tìm thấy dữ liệu phù hợp trong hệ thống.";

      } else if (
        conferences.length &&
        journals.length
      ) {

        answer =
          `Tìm thấy ${total} kết quả gồm hội thảo và tạp chí liên quan đến "${question}".`;

      } else if (
        conferences.length
      ) {

        answer =
          `Tìm thấy ${conferences.length} hội thảo phù hợp với "${question}".`;

      } else {

        answer =
          `Tìm thấy ${journals.length} tạp chí phù hợp với "${question}".`;
      }
    }


    // =====================================================
    // 12. SAVE LOCAL HISTORY
    // =====================================================

    try {

      addToHistory(
        req,
        question,
        answer
      );

    } catch (err) {

      console.warn(
        "⚠️ Cannot save history:",
        err?.message || err
      );
    }


    // =====================================================
    // 13. RESPONSE
    // =====================================================

    return {

      answer,

      conferences,

      journals,

      sources,

      domain:
        result?.domain ||
        "general",

      model: {

        model_id:
          llmResult?.model_id ||
          model_id ||
          null,

        model:
          llmResult?.model ||
          null,

        latency:
          llmResult?.latency ??
          null,

        prompt_tokens:
          llmResult?.usage
            ?.prompt_tokens ??
          null,

        output_tokens:
          llmResult?.usage
            ?.output_tokens ??
          null
      },

      responseTimeMs:
        Date.now() - start
    };


  } catch (err) {

    // =====================================================
    // GLOBAL ERROR
    // =====================================================

    console.error(
      "❌ Scholar agent crash:",
      err
    );


    return {

      answer:
        "Hệ thống đang gặp lỗi, vui lòng thử lại sau.",

      conferences:
        [],

      journals:
        [],

      sources:
        [],

      domain:
        "error",

      model:
        {
          model_id:
            model_id ||
            null,

          model:
            null,

          latency:
            null,

          prompt_tokens:
            null,

          output_tokens:
            null
        },

      responseTimeMs:
        Date.now() - start
    };
  }
}