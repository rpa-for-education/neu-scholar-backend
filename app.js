// app.js
import "dotenv/config";
import express from "express";
import axios from "axios";
import cron from "node-cron";
import { llmMap } from "./llm.js";
import { runImport } from "./import.js";
import { journalVectorSearch, conferenceVectorSearch } from "./search.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 0 * * *";
const DEFAULT_LLM_PROVIDER = (process.env.DEFAULT_LLM_PROVIDER || "qwen").toLowerCase();

// ===== API ngoài để fallback =====
async function fetchArticles() {
  try {
    const res = await axios.get(process.env.API_RESEARCH);
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.error("❌ Lỗi fetchArticles:", err.message);
    return [];
  }
}

// ===== Chuẩn hóa context =====
function buildPrompt(question, conferences = [], journals = []) {
  let context =
    "Bạn là trợ lý học thuật, trả lời ngắn gọn, trích dẫn tên hội thảo/tạp chí liên quan.\n\n";

  if (conferences.length) {
    context += "Danh sách hội thảo:\n";
    conferences.slice(0, 10).forEach((c, i) => {
      context += `Hội thảo ${i + 1}: 
- Tên: ${c.name || c.title || "Không có"} 
- Acronym: ${c.acronym || "Không có"} 
- Địa điểm: ${c.location || "Không có"} 
- Hạn nộp: ${c.deadline || "Không có"} 
- Ngày tổ chức: ${c.start_date || "Không có"} 
- Chủ đề: ${c.topics || "Không có"} 
- Link: ${c.url || "Không có"}\n\n`;
    });
  } else {
    context += "Không có hội thảo phù hợp.\n\n";
  }

  if (journals.length) {
    context += "Danh sách tạp chí:\n";
    journals.slice(0, 10).forEach((j, i) => {
      context += `Tạp chí ${i + 1}: 
- Tên: ${j.title || "Không có"} 
- Nhà xuất bản: ${j.publisher || "Không có"} 
- Lĩnh vực: ${j.areas || "Không có"} 
- Danh mục: ${j.categories || "Không có"} 
- ISSN: ${j.issn || "Không có"}\n\n`;
    });
  } else {
    context += "Không có tạp chí phù hợp.\n\n";
  }

  context += `\nCâu hỏi: ${question}\n\nHãy trả lời bằng tiếng Việt hoặc ngôn ngữ của câu hỏi.`;
  return context;
}

// ===== Agent API cải tiến với fallback =====
app.post("/api/agent", async (req, res) => {
  try {
    const { question, provider, model, topk = 5 } = req.body || {};
    if (!question?.trim()) {
      return res.status(400).json({ error: "Missing question" });
    }

    // 1. Tìm trong MongoDB
    let conferences = [];
    let journals = [];
    try {
      conferences = await conferenceVectorSearch(question, Number(topk));
    } catch (e) {
      console.error("Conference vector search failed:", e.message);
    }
    try {
      journals = await journalVectorSearch(question, Number(topk));
    } catch (e) {
      console.error("Journal vector search failed:", e.message);
    }

    // 2. Nếu DB rỗng → fallback API ngoài
    if (!conferences?.length) {
      const articles = await fetchArticles();
      conferences = articles.slice(0, topk);
    }

    // 3. Tạo prompt context
    const prompt = buildPrompt(question, conferences, journals);

    // 4. Gọi LLM theo fallback
    const tryProviders = [
      (provider || DEFAULT_LLM_PROVIDER).toLowerCase(),
      "openai",
      "local",
    ];

    let answer = null;
    let usedProvider = null;
    let lastError = null;

    for (const p of tryProviders) {
      if (!llmMap[p]) continue;
      try {
        answer = await llmMap[p](prompt, model);
        usedProvider = p;
        break; // thành công → thoát
      } catch (err) {
        lastError = err;
        console.error(`❌ Provider ${p} failed:`, err.message);
      }
    }

    if (!answer) throw lastError || new Error("All providers failed");

    res.json({
      provider: usedProvider,
      model: model || process.env[`${usedProvider.toUpperCase()}_MODEL`],
      answer,
      retrieved: { conference: conferences, journal: journals },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Boot =====
if (!process.env.VERCEL) {
  app.listen(PORT, async () => {
    console.log(`➡️ API listening on http://localhost:${PORT}`);
    try {
      await runImport();
    } catch (e) {
      console.error("Initial import failed:", e.message);
    }
  });

  cron.schedule(CRON_SCHEDULE, async () => {
    console.log("⏰ Running scheduled import...");
    try {
      await runImport();
      console.log("✅ Scheduled import ok");
    } catch (e) {
      console.error("❌ Scheduled import failed:", e.message);
    }
  });
}

export default app;
