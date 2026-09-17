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

    // Ưu tiên history đã normalize từ route/service
    // để tránh hai nguồn history không đồng nhất
    llmContext.history = normalizedHistory;

    console.log(
      "\n========== SCHOLAR AGENT =========="
    );

    console.log(
      "🧠 HISTORY ITEMS:",
      llmContext.history.length
    );

    console.log(
      "👤 PROFILE:",
      llmContext.profile?.full_name || "(none)"
    );

    console.log(
      "📌 PROJECT:",
      llmContext.project?.name || "(none)"
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
      "===================================\n"
    );


    // =====================================================
    // 2. SEARCH
    //
    // question
    //    ↓
    // runAgent
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
      result?.conferences || [];

    const journals =
      result?.journals || [];

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
        c.cfp_link ||
        c.url ||
        c.link ||
        c.website ||
        ""
      );
    }

    function buildJournalUrl(j) {
      return (
        j.url ||
        j.scimago_link ||
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

      const t =
        new Date(dateStr).getTime();

      return isNaN(t)
        ? null
        : t;
    }


    // =====================================================
    // 5. CONFERENCE STATUS
    // =====================================================

    function getConferenceStatus(c) {
      const now =
        Date.now();

      const deadline =
        safeTime(c.deadline);

      const start =
        safeTime(c.start_date);

      if (deadline) {
        const diff =
          (deadline - now) /
          (1000 * 60 * 60 * 24);

        if (diff > 30) {
          return "submission_open";
        }

        if (diff > 0) {
          return "submission_soon";
        }
      }

      if (
        deadline &&
        deadline < now
      ) {
        if (start) {
          const diffStart =
            (start - now) /
            (1000 * 60 * 60 * 24);

          if (diffStart > 0) {
            return "upcoming_event";
          }

          return "past_event";
        }

        return "submission_closed";
      }

      if (
        !deadline &&
        start
      ) {
        const diff =
          (start - now) /
          (1000 * 60 * 60 * 24);

        if (diff > 0) {
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
      ...conferences.map(
        (c, i) => ({
          id: `C${i + 1}`,

          type: "conference",

          title:
            c.name ||
            c.title ||
            c.acronym ||
            "Untitled conference",

          url:
            buildConferenceUrl(c),

          metadata: {
            ...(c.country && {
              country: c.country
            }),

            ...(c.city && {
              city: c.city
            }),

            ...(c.deadline && {
              deadline: c.deadline
            }),

            ...(c.start_date && {
              start_date: c.start_date
            }),

            conference_status:
              getConferenceStatus(c),

            ...(c.fields?.length && {
              fields: c.fields
            }),

            score:
              c.finalScore ?? 0
          }
        })
      ),

      ...journals.map(
        (j, i) => ({
          id: `J${i + 1}`,

          type: "journal",

          title:
            j.title ||
            "Untitled journal",

          url:
            buildJournalUrl(j),

          metadata: {
            ...(j.sjr_best_quartile && {
              quartile:
                j.sjr_best_quartile
            }),

            ...(j.publisher && {
              publisher:
                j.publisher
            }),

            ...(j.country && {
              country:
                j.country
            }),

            ...(j.fields?.length && {
              fields:
                j.fields
            }),

            score:
              j.finalScore ?? 0
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
    // Profile
    // Project
    // Documents
    // History
    // Conference / Journal results
    // Current question
    // =====================================================

    const prompt =
      buildScholarPrompt(
        question,
        conferences,
        journals,
        llmContext
      );

    console.log(
      "🤖 CALLING LLM..."
    );


    // =====================================================
    // 8. CALL LLM
    // =====================================================

    const llmResult =
      await callLLM(
        prompt,
        model_id
      );

    console.log(
      "🤖 LLM MODEL:",
      llmResult?.model || "(unknown)"
    );

    console.log(
      "⏱️ LLM LATENCY:",
      llmResult?.latency ?? "N/A",
      "ms"
    );


    // =====================================================
    // 9. FINAL ANSWER
    // =====================================================

    let answer =
      llmResult?.answer?.trim() ||
      "";


    // =====================================================
    // 10. FALLBACK
    //
    // Nếu LLM lỗi thì dùng answer deterministic
    // từ runAgent.
    // =====================================================

    if (!answer) {
      answer =
        result?.answer?.trim() ||
        "";
    }


    // =====================================================
    // 11. FINAL FALLBACK
    // =====================================================

    if (!answer) {
      if (
        !conferences.length &&
        !journals.length
      ) {
        answer =
          "Không tìm thấy dữ liệu phù hợp trong hệ thống.";
      } else {
        const total =
          conferences.length +
          journals.length;

        if (
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
    }


    // =====================================================
    // 12. SAVE HISTORY
    // =====================================================

    try {
      addToHistory(
        req,
        question,
        answer
      );

    } catch {
      console.warn(
        "⚠️ Cannot save history"
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
          model_id,

        model:
          llmResult?.model ||
          null,

        latency:
          llmResult?.latency ??
          null
      },

      responseTimeMs:
        Date.now() - start
    };

  } catch (err) {

    console.error(
      "❌ Scholar agent crash:",
      err
    );

    return {
      answer:
        "Hệ thống đang gặp lỗi, vui lòng thử lại sau.",

      conferences: [],
      journals: [],
      sources: [],

      domain: "error",

      responseTimeMs:
        Date.now() - start
    };
  }
}