import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import axios from "axios";
import { callLLM } from "./llm.js";
import { journalVectorSearch, conferenceVectorSearch, initEmbedding } from "./search.js";
import { getDb } from "./db.js"; 
import { encode } from "gpt-tokenizer";
import { addToMemory, getMemory } from "./memory.js";

const app = express();
const PORT = 4000;
const DEFAULT_MODEL_ID = "qwen-max";
const DEFAULT_LIMIT_JOURNAL = 100;
const DEFAULT_LIMIT_CONFERENCE = 100;
const DEFAULT_SHORT_MEMORY_SIZE = 10; // nhớ 10 câu gần nhất 

// ===== Middleware =====
app.use(cors());
app.use(session({
  secret: process.env.SESSION_SECRET || "fitneu2025",
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));
app.use(express.json({ limit: "10mb" }));

app.use((req, _res, next) => {
  console.log("📩 Request:", { method: req.method, url: req.url });
  next();
});

/* ===================== Helpers ===================== */
function formatAnswerText(rawText) {
  if (!rawText) return "";
  let text = rawText.replace(/\*\*/g, "");
  text = text.replace(/(\d+)\.\s+/g, "\n- ");
  text = text.replace(/\n+/g, "\n\n");
  return text.trim();
}

function parseBool(v) { return String(v).toLowerCase() === "true"; }
function getProjection(includeVector) { return includeVector ? {} : { vector: 0 }; }

/* ===================== MongoDB ===================== */
let db;
async function getCollection(name) {
  if (!db) db = await getDb();
  return db.collection(name);
}
async function Journals() { return getCollection("journal"); }
async function Conferences() { return getCollection("conference"); }

/* ===================== HEALTH ===================== */
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    db: db ? "connected" : "disconnected",
    time: new Date().toISOString(),
  });
});

/* ===================== JOURNALS CRUD ===================== */
app.get("/api/journals", async (req, res) => {
  try {
    const col = await Journals();
    const cursor = col.find({}, { projection: { title: 1, categories: 1, publisher: 1 } })
                      .limit(DEFAULT_LIMIT_JOURNAL)
                      .batchSize(1000);
    const items = [];
    await cursor.forEach(item => {
      items.push({
        name: item.title,
        quartiles: item.categories,
        publisher: item.publisher
      });
    });
    res.json({ total: items.length, items });
  } catch (err) {
    console.error("❌ /api/journals error:", err);
    res.status(500).json({ error: "Failed to fetch journals", detail: err.message });
  }
});

app.get("/api/journals/:id", async (req, res) => {
  try {
    const projection = getProjection(parseBool(req.query.includeVector));
    const { ObjectId } = await import("mongodb");
    const col = await Journals();
    const doc = await col.findOne({ _id: new ObjectId(req.params.id) }, { projection });
    if (!doc) return res.status(404).json({ error: "Journal not found" });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch journal", detail: err.message });
  }
});

app.post("/api/journals", async (req, res) => {
  try {
    const col = await Journals();
    const result = await col.insertOne(req.body);
    res.status(201).json({ _id: result.insertedId, ...req.body });
  } catch (err) {
    res.status(400).json({ error: "Failed to create journal", detail: err.message });
  }
});

app.put("/api/journals/:id", async (req, res) => {
  try {
    const { ObjectId } = await import("mongodb");
    const col = await Journals();
    const result = await col.findOneAndUpdate(
      { _id: new ObjectId(req.params.id) }, { $set: req.body }, { returnDocument: "after" }
    );
    if (!result.value) return res.status(404).json({ error: "Journal not found" });
    res.json(result.value);
  } catch (err) {
    res.status(400).json({ error: "Failed to update journal", detail: err.message });
  }
});

app.delete("/api/journals/:id", async (req, res) => {
  try {
    const { ObjectId } = await import("mongodb");
    const col = await Journals();
    const result = await col.findOneAndDelete({ _id: new ObjectId(req.params.id) });
    if (!result.value) return res.status(404).json({ error: "Journal not found" });
    res.json({ message: "Journal deleted", deleted: result.value });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete journal", detail: err.message });
  }
});

/* ===================== CONFERENCES CRUD ===================== */
app.get("/api/conferences", async (req, res) => {
  try {
    const col = await Conferences();
    const cursor = col.find({}, { projection: { _id: 0, name: 1, url: 1 } })
                      .sort({ created_time: -1 })
                      .limit(DEFAULT_LIMIT_CONFERENCE)
                      .batchSize(500);
    const items = [];
    await cursor.forEach(item => items.push(item));
    res.json({ total: items.length, items });
  } catch (err) {
    console.error("❌ /api/conferences error:", err);
    res.status(500).json({ error: "Failed to fetch conferences", detail: err.message });
  }
});

app.get("/api/conferences/:id", async (req, res) => {
  try {
    const projection = getProjection(parseBool(req.query.includeVector));
    const { ObjectId } = await import("mongodb");
    const col = await Conferences();
    const doc = await col.findOne({ _id: new ObjectId(req.params.id) }, { projection });
    if (!doc) return res.status(404).json({ error: "Conference not found" });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conference", detail: err.message });
  }
});

app.post("/api/conferences", async (req, res) => {
  try {
    const col = await Conferences();
    const result = await col.insertOne(req.body);
    res.status(201).json({ _id: result.insertedId, ...req.body });
  } catch (err) {
    res.status(400).json({ error: "Failed to create conference", detail: err.message });
  }
});

app.put("/api/conferences/:id", async (req, res) => {
  try {
    const { ObjectId } = await import("mongodb");
    const col = await Conferences();
    const result = await col.findOneAndUpdate(
      { _id: new ObjectId(req.params.id) }, { $set: req.body }, { returnDocument: "after" }
    );
    if (!result.value) return res.status(404).json({ error: "Conference not found" });
    res.json(result.value);
  } catch (err) {
    res.status(400).json({ error: "Failed to update conference", detail: err.message });
  }
});

app.delete("/api/conferences/:id", async (req, res) => {
  try {
    const { ObjectId } = await import("mongodb");
    const col = await Conferences();
    const result = await col.findOneAndDelete({ _id: new ObjectId(req.params.id) });
    if (!result.value) return res.status(404).json({ error: "Conference not found" });
    res.json({ message: "Conference deleted", deleted: result.value });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete conference", detail: err.message });
  }
});

/* ===================== API ngoài + Agent ===================== */
async function fetchArticles() {
  try {
    const res = await axios.get(process.env.API_RESEARCH);
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.error("❌ Lỗi fetchArticles:", err.message);
    return [];
  }
}

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

/* ===================== Agent API (short-term memory) ===================== */
app.post("/api/agent", async (req, res) => {
  const start = Date.now();
  try {
    const { question, model_id = DEFAULT_MODEL_ID, topk = 5 } = req.body || {};
    if (!question?.trim()) {
      return res.status(400).json({ error: "Missing question" });
    }

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

    if (!conferences.length && !journals.length) {
      const articles = await fetchArticles();
      conferences = articles.slice(0, topk);
    }

    const sid = req.sessionID;

    // Short-term memory chỉ lấy từ chat_history
    let memoryEntries = [];
    if (Array.isArray(req.body.chat_history) && req.body.chat_history.length) {
      console.log("DEBUG chat_history:");
      req.body.chat_history.forEach((entry, idx) => {
        console.log(`[${idx}] role: ${entry.role}, content: ${entry.content}`);
      });
      const recentHistory = req.body.chat_history.slice(-DEFAULT_SHORT_MEMORY_SIZE * 2);
      memoryEntries = recentHistory.map(entry => ({
        role: entry.role || "user",
        text: entry.content || ""
      })).filter(m => m.text.trim());
    } else {
      try {
        memoryEntries = await getMemory(sid, DEFAULT_SHORT_MEMORY_SIZE);
      } catch (e) {
        console.warn("⚠️ getMemory failed:", e);
        memoryEntries = [];
      }
    }

    const memoryText = memoryEntries.map(m => `- [${m.role}] ${m.text}`).join("\n");
    const prompt = buildPrompt(question, conferences, journals);

    const finalPrompt = `
Ngữ cảnh hội thoại gần đây:
${memoryText}

${prompt}
`;

    console.log("===== Prompt =====\n", finalPrompt);

    let answer = await callLLM(finalPrompt, model_id);
    if (typeof answer === "string") {
      answer = formatAnswerText(answer);
    }

    if (!req.body.chat_history) {
      try {
        await addToMemory(sid, "user", question, DEFAULT_SHORT_MEMORY_SIZE);
        await addToMemory(sid, "assistant", answer, DEFAULT_SHORT_MEMORY_SIZE);
      } catch (e) {
        console.warn("⚠️ addToMemory failed:", e);
      }
    }

    const responseTimeMs = Date.now() - start;
    const tokensUsed = (() => {
      try {
        return encode(finalPrompt).length + encode(answer).length;
      } catch {
        return null;
      }
    })();

    try {
      const col = await getCollection("chatlogs");
      await col.insertOne({
        question,
        answer,
        sessionId: sid,
        model_id,
        responseTimeMs,
        tokensUsed,
        createdAt: new Date()
      });
    } catch (e) {
      console.error("❌ Log save failed:", e);
    }

    res.json({
      model_id,
      answer,
      retrieved: { conference: conferences, journal: journals },
      memoryCount: memoryEntries.length,
      responseTimeMs,
      tokensUsed
    });

  } catch (e) {
    res.status(500).json({ error: e.message || "Internal error" });
  }
});

/* ===================== Boot ===================== */
if (!process.env.VERCEL) {
  app.listen(PORT, async () => {
    console.log(`➡️ API listening on http://localhost:${PORT}`);
    initEmbedding().catch(e => console.error("Embedding preload failed:", e.message));
  });
}


export default app;
