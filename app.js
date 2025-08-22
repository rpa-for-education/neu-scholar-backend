// app.js
import "dotenv/config";
import express from "express";
import axios from "axios";
import { callLLM } from "./llm.js";
import { journalVectorSearch, conferenceVectorSearch, initEmbedding } from "./search.js";
import { getDb } from "./db.js"; // ✅ dùng db.js thay vì mongoose

const app = express();
app.use(express.json());

const PORT = 4000;
const DEFAULT_MODEL_ID = "qwen-max";

/* ===================== MongoDB Connect ===================== */
let db;
(async () => {
  try {
    db = await getDb();
  } catch (err) {
    console.error("❌ MongoDB init error:", err.message);
  }
})();

/* ===================== Collections ===================== */
function Journals() {
  return db.collection("journal");
}
function Conferences() {
  return db.collection("conference");
}

/* =========== Helpers: query, pagination, projection =========== */
function parseBool(v) {
  return String(v).toLowerCase() === "true";
}
function getProjection(includeVector) {
  return includeVector ? {} : { vector: 0 };
}
function getPagination(req) {
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || "0", 10), 0), 500); // 0 = lấy tất cả
  const skip = limit ? (page - 1) * limit : 0;
  return { page, limit, skip };
}
function buildSearchFilter(q, fields) {
  if (!q || !q.trim()) return {};
  const regex = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return { $or: fields.map(f => ({ [f]: regex })) };
}

/* ===================== HEALTH ===================== */
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    db: db ? "connected" : "disconnected",
    time: new Date().toISOString(),
  });
});

/* ===================== JOURNALS CRUD ===================== */

// GET /api/journals  (list/search/pagination)
app.get("/api/journals", async (req, res) => {
  try {
    const { q, includeVector } = req.query;
    const projection = getProjection(parseBool(includeVector));
    const { limit, skip, page } = getPagination(req);

    const filter = buildSearchFilter(q, [
      "title",
      "publisher",
      "areas",
      "categories",
      "country",
      "region",
      "issn",
      "_key",
      "id_journal",
      "sjr",
      "sjr_best_quartile"
    ]);

    if (!limit) {
      const data = await Journals().find(filter, { projection }).sort({ created_time: -1 }).toArray();
      return res.json({ page: 1, total: data.length, items: data });
    }

    const cursor = Journals().find(filter, { projection }).sort({ created_time: -1 }).skip(skip).limit(limit);
    const [items, total] = await Promise.all([cursor.toArray(), Journals().countDocuments(filter)]);
    res.json({ page, limit, total, items });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch journals", detail: err.message });
  }
});

// GET /api/journals/:id
app.get("/api/journals/:id", async (req, res) => {
  try {
    const projection = getProjection(parseBool(req.query.includeVector));
    const { ObjectId } = await import("mongodb");
    const doc = await Journals().findOne({ _id: new ObjectId(req.params.id) }, { projection });
    if (!doc) return res.status(404).json({ error: "Journal not found" });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch journal", detail: err.message });
  }
});

// POST /api/journals
app.post("/api/journals", async (req, res) => {
  try {
    const result = await Journals().insertOne(req.body);
    res.status(201).json({ _id: result.insertedId, ...req.body });
  } catch (err) {
    res.status(400).json({ error: "Failed to create journal", detail: err.message });
  }
});

// PUT /api/journals/:id
app.put("/api/journals/:id", async (req, res) => {
  try {
    const { ObjectId } = await import("mongodb");
    const result = await Journals().findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: req.body },
      { returnDocument: "after" }
    );
    if (!result.value) return res.status(404).json({ error: "Journal not found" });
    res.json(result.value);
  } catch (err) {
    res.status(400).json({ error: "Failed to update journal", detail: err.message });
  }
});

// DELETE /api/journals/:id
app.delete("/api/journals/:id", async (req, res) => {
  try {
    const { ObjectId } = await import("mongodb");
    const result = await Journals().findOneAndDelete({ _id: new ObjectId(req.params.id) });
    if (!result.value) return res.status(404).json({ error: "Journal not found" });
    res.json({ message: "Journal deleted", deleted: result.value });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete journal", detail: err.message });
  }
});

/* ===================== CONFERENCES CRUD ===================== */

// GET /api/conferences  (list/search/pagination)
app.get("/api/conferences", async (req, res) => {
  try {
    const { q, includeVector } = req.query;
    const projection = getProjection(parseBool(includeVector));
    const { limit, skip, page } = getPagination(req);

    const filter = buildSearchFilter(q, [
      "name",
      "title",
      "acronym",
      "location",
      "topics",
      "url",
      "_key",
      "id_conference",
      "deadline",
      "start_date"
    ]);

    if (!limit) {
      const data = await Conferences().find(filter, { projection }).sort({ created_time: -1 }).toArray();
      return res.json({ page: 1, total: data.length, items: data });
    }

    const cursor = Conferences().find(filter, { projection }).sort({ created_time: -1 }).skip(skip).limit(limit);
    const [items, total] = await Promise.all([cursor.toArray(), Conferences().countDocuments(filter)]);
    res.json({ page, limit, total, items });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conferences", detail: err.message });
  }
});

// GET /api/conferences/:id
app.get("/api/conferences/:id", async (req, res) => {
  try {
    const projection = getProjection(parseBool(req.query.includeVector));
    const { ObjectId } = await import("mongodb");
    const doc = await Conferences().findOne({ _id: new ObjectId(req.params.id) }, { projection });
    if (!doc) return res.status(404).json({ error: "Conference not found" });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conference", detail: err.message });
  }
});

// POST /api/conferences
app.post("/api/conferences", async (req, res) => {
  try {
    const result = await Conferences().insertOne(req.body);
    res.status(201).json({ _id: result.insertedId, ...req.body });
  } catch (err) {
    res.status(400).json({ error: "Failed to create conference", detail: err.message });
  }
});

// PUT /api/conferences/:id
app.put("/api/conferences/:id", async (req, res) => {
  try {
    const { ObjectId } = await import("mongodb");
    const result = await Conferences().findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: req.body },
      { returnDocument: "after" }
    );
    if (!result.value) return res.status(404).json({ error: "Conference not found" });
    res.json(result.value);
  } catch (err) {
    res.status(400).json({ error: "Failed to update conference", detail: err.message });
  }
});

// DELETE /api/conferences/:id
app.delete("/api/conferences/:id", async (req, res) => {
  try {
    const { ObjectId } = await import("mongodb");
    const result = await Conferences().findOneAndDelete({ _id: new ObjectId(req.params.id) });
    if (!result.value) return res.status(404).json({ error: "Conference not found" });
    res.json({ message: "Conference deleted", deleted: result.value });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete conference", detail: err.message });
  }
});

/* ===================== API ngoài để fallback ===================== */
async function fetchArticles() {
  try {
    const res = await axios.get(process.env.API_RESEARCH);
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.error("❌ Lỗi fetchArticles:", err.message);
    return [];
  }
}

/* ===================== Chuẩn hóa context ===================== */
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

/* ===================== Agent API (giữ nguyên) ===================== */
app.post("/api/agent", async (req, res) => {
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

    if (!conferences?.length) {
      const articles = await fetchArticles();
      conferences = articles.slice(0, topk);
    }

    const prompt = buildPrompt(question, conferences, journals);
    const answer = await callLLM(prompt, model_id);

    res.json({
      model_id,
      answer,
      retrieved: { conference: conferences, journal: journals },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
