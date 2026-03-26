// scholar.service.js
import { runAgent } from "./scholar.agent.js";
import { addToHistory } from "../../middlewares/session.js";

export async function runScholarAgent(req, question, model_id, topk) {
  const start = Date.now();

  try {
    // ================= SEARCH =================
    const result = await runAgent(question, topk);

    const conferences = result?.conferences || [];
    const journals = result?.journals || [];

    console.log("📊 SEARCH:", conferences.length, journals.length);

    // ================= NO DATA =================
    if (!conferences.length && !journals.length) {
      return {
        answer: "Không tìm thấy dữ liệu phù hợp trong hệ thống.",
        conferences: [],
        journals: [],
        sources: [],
        domain: "empty",
        responseTimeMs: Date.now() - start
      };
    }

    // ================= 🔥 SMART ANSWER =================
    const total = conferences.length + journals.length;

    let answer = result?.answer || "";

    if (!answer || answer.length < 10) {
      if (conferences.length && journals.length) {
        answer = `Tìm thấy ${total} kết quả gồm hội thảo và tạp chí liên quan đến "${question}".`;
      } else if (conferences.length) {
        answer = `Tìm thấy ${conferences.length} hội thảo phù hợp với "${question}".`;
      } else {
        answer = `Tìm thấy ${journals.length} tạp chí phù hợp với "${question}".`;
      }

      // 🔥 enrich insight
      const now = Date.now();

      const hasOpenCFP = conferences.some(c => {
        const d = safeTime(c.deadline);
        return d && d > now;
      });

      const hasUpcomingEvent = conferences.some(c => {
        const d = safeTime(c.start_date);
        return d && d > now;
      });

      if (hasOpenCFP) {
        answer += " Một số hội thảo vẫn còn hạn nộp bài.";
      }

      if (hasUpcomingEvent) {
        answer += " Có hội thảo sắp diễn ra.";
      }
    }

    // ================= URL HELPER =================
    function buildConferenceUrl(c) {
      return (
        c.cfp_link ||
        c.url ||
        c.link ||
        c.website ||
        "" // ❌ KHÔNG dùng Google search nữa
      );
    }

    function buildJournalUrl(j) {
      return j.url || j.scimago_link || "";
    }

    // ================= SAFE DATE =================
    function safeTime(dateStr) {
      if (!dateStr) return null;
      const t = new Date(dateStr).getTime();
      return isNaN(t) ? null : t;
    }

    // ================= STATUS =================
    function getConferenceStatus(c) {
      const now = Date.now();

      const deadline = safeTime(c.deadline);
      const start = safeTime(c.start_date);

      if (deadline) {
        const diff = (deadline - now) / (1000 * 60 * 60 * 24);

        if (diff > 30) return "submission_open";
        if (diff > 0) return "submission_soon";
      }

      if (deadline && deadline < now) {
        if (start) {
          const diffStart = (start - now) / (1000 * 60 * 60 * 24);

          if (diffStart > 0) return "upcoming_event";
          return "past_event";
        }
        return "submission_closed";
      }

      if (!deadline && start) {
        const diff = (start - now) / (1000 * 60 * 60 * 24);

        if (diff > 0) return "upcoming_event";
        return "past_event";
      }

      return "unknown";
    }

    // ================= BUILD SOURCES =================
    const sources = [
      ...conferences.map((c, i) => ({
        id: `C${i + 1}`,
        type: "conference",
        title: c.name || c.title,
        url: buildConferenceUrl(c),

        metadata: {
          ...(c.country && { country: c.country }),
          ...(c.city && { city: c.city }),

          ...(c.deadline && { deadline: c.deadline }),
          ...(c.start_date && { start_date: c.start_date }),

          conference_status: getConferenceStatus(c),

          ...(c.fields?.length && { fields: c.fields }),
          score: c.finalScore ?? 0
        }
      })),

      ...journals.map((j, i) => ({
        id: `J${i + 1}`,
        type: "journal",
        title: j.title,
        url: buildJournalUrl(j),

        metadata: {
          ...(j.sjr_best_quartile && { quartile: j.sjr_best_quartile }),
          ...(j.publisher && { publisher: j.publisher }),
          ...(j.country && { country: j.country }),

          ...(j.fields?.length && { fields: j.fields }),
          score: j.finalScore ?? 0
        }
      }))
    ];

    console.log("📦 SOURCES:", sources.length);

    // ================= SAVE HISTORY =================
    try {
      addToHistory(req, question, answer);
    } catch {
      console.warn("⚠️ Cannot save history");
    }

    return {
      answer,
      conferences,
      journals,
      sources,
      domain: result?.domain || "general",
      responseTimeMs: Date.now() - start
    };

  } catch (err) {
    console.error("❌ Scholar agent crash:", err);

    return {
      answer: "Hệ thống đang gặp lỗi, vui lòng thử lại sau.",
      conferences: [],
      journals: [],
      sources: [],
      domain: "error",
      responseTimeMs: Date.now() - start
    };
  }
}