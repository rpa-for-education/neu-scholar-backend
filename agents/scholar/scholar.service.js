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
        answer = `Tìm thấy ${total} kết quả phù hợp gồm hội thảo và tạp chí liên quan đến "${question}".`;
      } else if (conferences.length) {
        answer = `Tìm thấy ${conferences.length} hội thảo phù hợp với "${question}".`;
      } else {
        answer = `Tìm thấy ${journals.length} tạp chí phù hợp với "${question}".`;
      }
    }

    // ================= URL HELPER =================
    function buildConferenceUrl(c) {
      return (
        c.url ||
        c.link ||
        c.website ||
        (c.title || c.name
          ? `https://www.google.com/search?q=${encodeURIComponent(
              `${c.title || c.name} ${c.acronym || ""} conference ${c.city || ""}`
            )}`
          : "")
      );
    }

    function buildJournalUrl(j) {
      return j.url || j.scimago_link || "";
    }

    // ================= BUILD SOURCES =================
    const sources = [
      ...conferences.map((c, i) => ({
        id: `C${i + 1}`,
        type: "conference",
        title: c.name || c.title,
        url: buildConferenceUrl(c),
        metadata: {
          country: c.country,
          city: c.city,
          deadline: c.deadline,
        }
      })),
      ...journals.map((j, i) => ({
        id: `J${i + 1}`,
        type: "journal",
        title: j.title,
        url: buildJournalUrl(j),
        metadata: {
          quartile: j.sjr_best_quartile,
          publisher: j.publisher,
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