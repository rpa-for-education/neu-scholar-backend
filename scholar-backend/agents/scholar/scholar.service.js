// scholar.service.js (ENHANCED ANSWER)

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

    const total = conferences.length + journals.length;

    let answer = result?.answer || "";

    // ================= 🔥 SMART ANSWER =================
    if (!answer || answer.length < 20) {

      // ================= BASIC =================
      if (conferences.length && journals.length) {
        answer = `Tìm thấy ${total} kết quả gồm hội thảo và tạp chí liên quan đến "${question}".`;
      } else if (conferences.length) {
        answer = `Tìm thấy ${conferences.length} hội thảo phù hợp với "${question}".`;
      } else {
        answer = `Tìm thấy ${journals.length} tạp chí phù hợp với "${question}".`;
      }

      // ================= 🔥 INSIGHT (PRO LEVEL) =================
      const now = Date.now();

      const openCFP = conferences.filter(c => {
        const d = safeTime(c.deadline);
        return d && d > now;
      });

      const upcoming = conferences.filter(c => {
        const d = safeTime(c.start_date);
        return d && d > now;
      });

      const topScore =
        Math.max(
          ...conferences.map(c => c.finalScore || 0),
          ...journals.map(j => j.finalScore || 0)
        ) || 0;

      // 🔥 Insight block
      let insight = [];

      if (topScore > 0.75) {
        insight.push("Các kết quả có mức độ liên quan cao.");
      } else if (topScore > 0.5) {
        insight.push("Kết quả có mức độ liên quan khá.");
      } else {
        insight.push("Kết quả mang tính tham khảo.");
      }

      if (openCFP.length) {
        insight.push(`${openCFP.length} hội thảo vẫn đang mở nhận bài.`);
      }

      if (upcoming.length) {
        insight.push(`${upcoming.length} hội thảo sắp diễn ra.`);
      }

      // 🔥 thêm 1 insight ranking
      if (conferences.length > 3) {
        insight.push("Danh sách đã được ưu tiên theo độ phù hợp.");
      }

      if (insight.length) {
        answer += "\n\n👉 " + insight.join(" ");
      }
    }

    // ================= URL =================
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

    // ================= HISTORY =================
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