// app.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import axios from "axios";
import { callLLM } from "./llm.js";
import { journalVectorSearch, conferenceVectorSearch, initEmbedding } from "./search.js";
import { getDb } from "./db.js"; // ✅ dùng db.js thay vì mongoose
import { encode } from "gpt-tokenizer"; // ✅ thêm để tính token

const app = express(); 
const PORT = 4000;
const DEFAULT_MODEL_ID = "qwen-max";

// ===== Middleware =====
app.use(cors()); // ✅ Cho phép mọi origin gọi API
app.use(express.json({ limit: "10mb" }));

// Debug log middleware
app.use((req, res, next) => {
  console.log("📩 Request:", {
    method: req.method,
    url: req.url,
    body: req.body,
  });
  next();
});

/* ===================== MongoDB Connect ===================== */
let db;
async function getCollection(name) {
  if (!db) {
    db = await getDb();
  }
  return db.collection(name);
}

/* ===================== Collections ===================== */
async function Journals() {
  return getCollection("journal");
}
async function Conferences() {
  return getCollection("conference");
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
  const regex = new RegExp(q.trim().replace(/[.*+?^${}()|[\\]\\]/g, "\\$&"), "i");
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
app.get("/api/journals", async (req, res) => {
  try {
    const col = await Journals();
    const { q } = req.query;
    const { limit, skip, page } = getPagination(req);
    const safeLimit = limit || 50; // ✅ limit mặc định

    // filter: ưu tiên text search nếu có index
    let filter = {};
    if (q?.trim()) {
      filter = { $text: { $search: q.trim() } };
    }

    const pipeline = [];
    if (Object.keys(filter).length) pipeline.push({ $match: filter });
    pipeline.push({ $sort: { created_time: -1 } });

    pipeline.push({
      $facet: {
        items: [
          { $skip: skip },
          { $limit: safeLimit },
          {
            $project: {
              name: "$title",
              quartiles: "$categories",
              publisher: 1
            }
          }
        ],
        total: [{ $count: "count" }]
      }
    });

    const result = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();
    const { items, total } = result[0];
    const totalCount = total.length ? total[0].count : 0;

    return res.json({
      page,
      limit: safeLimit,
      total: totalCount,
      items,
    });
  } catch (err) {
    console.error("❌ /api/journals error:", err);
    return res.status(500).json({ error: "Failed to fetch journals", detail: err.message });
  }
});

// GET /api/journals/:id
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

// POST /api/journals
app.post("/api/journals", async (req, res) => {
  try {
    const col = await Journals();
    const result = await col.insertOne(req.body);
    res.status(201).json({ _id: result.insertedId, ...req.body });
  } catch (err) {
    res.status(400).json({ error: "Failed to create journal", detail: err.message });
  }
});

// PUT /api/journals/:id
app.put("/api/journals/:id", async (req, res) => {
  try {
    const { ObjectId } = await import("mongodb");
    const col = await Journals();
    const result = await col.findOneAndUpdate(
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
    const { q, includeVector } = req.query;
    const projection = {
      _id: 0,
      _key: 0,
      acronym: 0,
      created_time: 0,
      deadline: 0,
      id_conference: 0,
      location: 0,
      modified_time: 0,
      topics: 0,
      ...(includeVector ? {} : { vector: 0 })
    };

    const { limit, skip, page } = getPagination(req);
    const safeLimit = limit || 50;

    let filter = {};
    if (q?.trim()) {
      filter = { $text: { $search: q.trim() } };
    }

    const pipeline = [];
    if (Object.keys(filter).length) pipeline.push({ $match: filter });
    pipeline.push({ $sort: { created_time: -1 } });

    pipeline.push({
      $facet: {
        items: [
          { $skip: skip },
          { $limit: safeLimit },
          { $project: projection }
        ],
        total: [{ $count: "count" }]
      }
    });

    const col = await Conferences();
    const result = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();
    const { items, total } = result[0];
    const totalCount = total.length ? total[0].count : 0;

    res.json({ page, limit: safeLimit, total: totalCount, items });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conferences", detail: err.message });
  }
});

// GET /api/conferences/:id
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

// POST /api/conferences
app.post("/api/conferences", async (req, res) => {
  try {
    const col = await Conferences();
    const result = await col.insertOne(req.body);
    res.status(201).json({ _id: result.insertedId, ...req.body });
  } catch (err) {
    res.status(400).json({ error: "Failed to create conference", detail: err.message });
  }
});

// PUT /api/conferences/:id
app.put("/api/conferences/:id", async (req, res) => {
  try {
    const { ObjectId } = await import("mongodb");
    const col = await Conferences();
    const result = await col.findOneAndUpdate(
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
    const col = await Conferences();
    const result = await col.findOneAndDelete({ _id: new ObjectId(req.params.id) });
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

/* ===================== Agent API ===================== */
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

    // fallback nếu không có kết quả
    if (!conferences?.length && !journals?.length) {
      const articles = await fetchArticles();
      conferences = articles.slice(0, topk);
    }

    const prompt = buildPrompt(question, conferences, journals);
    const answer = await callLLM(prompt, model_id);

    const response_time_ms = Date.now() - start;
    const asked_at = new Date().toISOString();
    const answered_at = new Date().toISOString();

    // Tính token
    const prompt_tokens = encode(prompt).length;
    const answer_tokens = encode(typeof answer === "string" ? answer : JSON.stringify(answer)).length;
    const tokens_used = prompt_tokens + answer_tokens;

    // base log
    const logBase = {
      question,
      asked_at,
      answer,
      answered_at,
      withLLM: true,
      model_id,
      provider: model_id.includes("qwen") ? "qwen" : "openai",
      model: model_id,
      topk: Number(topk),
    };

    // 🎯 Quyết định type và score
    const score_conf = conferences?.length || 0;
    const score_jour = journals?.length || 0;

    let type = null;
    let hits = [];
    if (score_conf > score_jour) {
      type = "conference";
      hits = conferences;
    } else if (score_jour > score_conf) {
      type = "journal";
      hits = journals;
    } else if (score_conf > 0 && score_jour > 0) {
      type = "both";
      hits = { conferences, journals };
    }

    // 📝 Ghi log vào chatlogs
    try {
      const col = await getCollection("chatlogs");
      await col.insertOne({
        ...logBase,
        type,
        score_conf,
        score_jour,
        hits,
        response_time_ms,
        prompt_tokens,
        answer_tokens,
        tokens_used,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error("❌ Lỗi ghi log:", err.message);
    }

    // 📤 Trả về client (GIỮ NGUYÊN)
    res.json({
      model_id,
      answer,
      retrieved: { conference: conferences, journal: journals },
      meta: {
        response_time_ms,
        tokens_used,
        prompt_tokens,
        answer_tokens
      }
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
