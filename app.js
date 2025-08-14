// app.js
import "dotenv/config";
import express from "express";
import { ObjectId } from "mongodb";
import { callGemini, callQwen } from "./llm.js";
import { runImport } from "./import.js";
import { journalVectorSearch, conferenceVectorSearch } from "./search.js";
import { getDb } from "./db.js"; // Dùng chung getDb
import cron from "node-cron";
import cors from "cors";

const app = express();

// Danh sách website được phép truy cập khi chế độ "khóa"
const allowedOrigins = [
  "https://neu-scholar-frontend.vercel.app",
  "https://research.neu.edu.vn",
  "http://localhost:5173"
];

// 🔄 Chuyển giữa chế độ mở toàn bộ và khóa
const allowAll = true; // đổi thành false để khóa theo danh sách

// Middleware CORS — xử lý cả preflight OPTIONS
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (allowAll) {
    res.header("Access-Control-Allow-Origin", "*");
  } else {
    if (allowedOrigins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    }
  }

  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Trả về OK ngay cho preflight
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

// Nếu muốn vẫn dùng cors package (optional)
app.use(cors({
  origin: allowAll
    ? "*"
    : function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Middleware parse JSON
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 0 * * *";
const DEFAULT_LLM_PROVIDER = (process.env.DEFAULT_LLM_PROVIDER || "gemini").toLowerCase();

// ===== Text search fallback =====
function buildRegex(q) {
  return new RegExp(".*" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ".*", "i");
}

async function textSearchConference({ q, limit = 10 }) {
  const db = await getDb();
  const re = buildRegex(q);
  return db.collection("conference")
    .find({
      $or: [
        { name: { $regex: re } },
        { acronym: { $regex: re } },
        { topics: { $regex: re } },
        { location: { $regex: re } }
      ]
    })
    .limit(limit)
    .toArray();
}

async function textSearchJournal({ q, limit = 10 }) {
  const db = await getDb();
  const re = buildRegex(q);
  return db.collection("journal")
    .find({
      $or: [
        { title: { $regex: re } },
        { categories: { $regex: re } },
        { areas: { $regex: re } },
        { publisher: { $regex: re } },
        { issn: { $regex: re } }
      ]
    })
    .limit(limit)
    .toArray();
}

// ===== API =====
app.get("/api/journals", async (req, res) => {
  try {
    const { q, limit = 50, skip = 0 } = req.query;
    const db = await getDb();

    console.log("📂 Querying collection:", "journal");

    let filter = {};
    if (q) {
      filter = {
        $or: [
          { title: new RegExp(q, "i") },
          { categories: new RegExp(q, "i") },
          { areas: new RegExp(q, "i") },
          { publisher: new RegExp(q, "i") },
          { issn: new RegExp(q, "i") }
        ]
      };
    }

    const data = await db.collection("journal")
                         .find(filter)
                         .skip(Number(skip))
                         .limit(Number(limit))
                         .toArray();

    res.json(data);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/conferences", async (req, res) => {
  try {
    const { q, limit = 50, skip = 0 } = req.query;
    const db = await getDb();

    console.log("📂 Querying collection:", "conference");

    let filter = {};
    if (q) {
      filter = {
        $or: [
          { name: new RegExp(q, "i") },
          { acronym: new RegExp(q, "i") },
          { topics: new RegExp(q, "i") },
          { location: new RegExp(q, "i") },
          { country: new RegExp(q, "i") }
        ]
      };
    }

    const data = await db.collection("conference")
                         .find(filter)
                         .skip(Number(skip))
                         .limit(Number(limit))
                         .toArray();

    res.json(data);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Search API =====
app.get("/api/journals/search", async (req, res) => {
  try {
    const { q, limit = 5 } = req.query;
    if (!q?.trim()) return res.status(400).json({ error: "Missing query param q" });

    let results = [];
    try {
      results = await journalVectorSearch(q, Number(limit));
      if (!results?.length) results = await textSearchJournal({ q, limit: Number(limit) });
    } catch (err) {
      console.error("Journal vector search failed:", err.message);
      results = await textSearchJournal({ q, limit: Number(limit) });
    }

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/conferences/search", async (req, res) => {
  try {
    const { q, limit = 5 } = req.query;
    if (!q?.trim()) return res.status(400).json({ error: "Missing query param q" });

    let results = [];
    try {
      results = await conferenceVectorSearch(q, Number(limit));
      if (!results?.length) results = await textSearchConference({ q, limit: Number(limit) });
    } catch (err) {
      console.error("Conference vector search failed:", err.message);
      results = await textSearchConference({ q, limit: Number(limit) });
    }

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Search All =====
app.all("/api/search/all", async (req, res) => {
  try {
    const q = req.query.q || req.body.q;
    const limit = Number(req.query.limit || req.body.limit || 5);
    if (!q?.trim()) return res.status(400).json({ error: "Missing query param q" });

    let journals = [];
    let conferences = [];

    try {
      journals = await journalVectorSearch(q, limit);
      if (!journals?.length) journals = await textSearchJournal({ q, limit });
    } catch (e) {
      console.error("Journal vector search failed:", e.message);
      journals = await textSearchJournal({ q, limit });
    }

    try {
      conferences = await conferenceVectorSearch(q, limit);
      if (!conferences?.length) conferences = await textSearchConference({ q, limit });
    } catch (e) {
      console.error("Conference vector search failed:", e.message);
      conferences = await textSearchConference({ q, limit });
    }

    res.json({
      query: q,
      limit,
      journals,
      conferences,
      total: (journals?.length || 0) + (conferences?.length || 0)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Agent API =====
app.post("/api/agent", async (req, res) => {
  try {
    const { question, provider, topk = 5 } = req.body || {};
    if (!question?.trim()) return res.status(400).json({ error: "Missing question" });

    let conferences = [];
    let journals = [];

    try {
      conferences = await conferenceVectorSearch(question, Number(topk));
      if (!conferences?.length) conferences = await textSearchConference({ q: question, limit: Number(topk) });
    } catch (e) {
      console.error("Conference vector search failed:", e.message);
      conferences = await textSearchConference({ q: question, limit: Number(topk) });
    }

    try {
      journals = await journalVectorSearch(question, Number(topk));
      if (!journals?.length) journals = await textSearchJournal({ q: question, limit: Number(topk) });
    } catch (e) {
      console.error("Journal vector search failed:", e.message);
      journals = await textSearchJournal({ q: question, limit: Number(topk) });
    }

    const simplifyConferenceData = (list) =>
      (list || []).map(c => ({
        title: c.name || c.title,
        acronym: c.acronym,
        location: c.location,
        start_date: c.start_date,
        deadline: c.deadline,
        topics: c.topics
      }));

    const simplifyJournalData = (list) =>
      (list || []).map(j => ({
        title: j.title,
        publisher: j.publisher,
        categories: j.categories,
        areas: j.areas
      }));

    const context = [
      "Bạn là trợ lý học thuật. Trả lời ngắn gọn, trích dẫn tên hội thảo/tạp chí liên quan.",
      conferences?.length ? `Hội thảo (JSON):\n${JSON.stringify(simplifyConferenceData(conferences), null, 2)}` : "Không có hội thảo phù hợp.",
      journals?.length ? `Tạp chí (JSON):\n${JSON.stringify(simplifyJournalData(journals), null, 2)}` : "Không có tạp chí phù hợp."
    ].join("\n\n");

    const prompt = `${context}\n\nCâu hỏi người dùng: ${question}\n\nHãy trả lời bằng tiếng Việt hoặc ngôn ngữ câu hỏi.`;
    const useProvider = (provider || DEFAULT_LLM_PROVIDER).toLowerCase();
    const llmMap = { gemini: callGemini, qwen: callQwen };
    if (!llmMap[useProvider]) throw new Error(`Unknown provider: ${useProvider}`);

    const answer = await llmMap[useProvider](prompt);

    res.json({ provider: useProvider, answer, retrieved: { conference: conferences, journal: journals } });
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

  // Cron local
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

// ===== Export app để Vercel dùng =====
export default app;