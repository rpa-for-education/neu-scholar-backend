// app.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import compression from "compression";
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
app.use(compression()); // ✅ nén gzip để trả nhanh hơn
app.set("etag", false);
app.set("x-powered-by", false);

// Debug log middleware
app.use((req, _res, next) => {
  console.log("📩 Request:", {
    method: req.method,
    url: req.url,
    // body: req.body, // có thể bật khi cần
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
  // dùng env nếu có chỉ định tên collection
  const name = process.env.MONGO_JOURNAL_COLLECTION || "journal";
  return getCollection(name);
}
async function Conferences() {
  const name = process.env.MONGO_CONFERENCE_COLLECTION || "conference";
  return getCollection(name);
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
  return { $or: fields.map((f) => ({ [f]: regex })) };
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
/**
 * Yêu cầu:
 *  - Luôn load TẤT CẢ bản ghi
 *  - Trả nhanh: chỉ field nhẹ + sort theo _id (index mặc định) + batchSize lớn + gzip
 *  - Tổng bản ghi: dùng countDocuments({}, { hint: "_id_" }) để ra đúng số lượng thực tế
 *  - Giữ nguyên format trả về như trước (name, quartiles, publisher)
 */
app.get("/api/journals", async (_req, res) => {
  try {
    const col = await Journals();

    // projection chỉ field nhẹ, bỏ _id để payload nhỏ
    const projection = { _id: 0, title: 1, categories: 1, publisher: 1, url: 1 };

    // sort theo _id để dùng index mặc định (nhanh hơn sort created_time nếu chưa có index)
    const cursor = col.find({}, { projection }).sort({ _id: 1 }).batchSize(2000);

    const itemsRaw = await cursor.toArray();

    const items = itemsRaw.map((item) => ({
      name: item?.title ?? null,
      quartiles: item?.categories ?? null,
      publisher: item?.publisher ?? null,
      url: item?.url ?? null,
    }));

    // Đếm CHÍNH XÁC (không ước lượng)
    let total = items.length;
    try {
      total = await col.countDocuments({}, { hint: "_id_" });
    } catch (_) {
      // nếu hint không có (rất hiếm), fallback length để không lỗi
      total = items.length;
    }

    res.setHeader("X-Total-Count", String(total));
    return res.json({
      total,
      items,
    });
  } catch (err) {
    console.error("❌ /api/journals error:", err);
    return res
      .status(500)
      .json({ error: "Failed to fetch journals", detail: err.message });
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
/**
 * Yêu cầu:
 *  - Luôn load TẤT CẢ bản ghi
 *  - Trả về đúng 2 trường name + url (đã có sẵn trong DB)
 *  - Tối ưu tốc độ tương tự journals
 */
app.get("/api/conferences", async (_req, res) => {
  try {
    const col = await Conferences();

    const projection = { _id: 0, name: 1, url: 1 };
    const cursor = col.find({}, { projection }).sort({ _id: 1 }).batchSize(2000);
    const items = await cursor.toArray();

    let total = items.length;
    try {
      total = await col.countDocuments({}, { hint: "_id_" });
    } catch (_) {
      total = items.length;
    }

    res.setHeader("X-Total-Count", String(total));
    res.json({ total, items });
  } catch (err) {
    console.error("❌ /api/conferences error:", err);
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
    const answer_tokens = encode(
      typeof answer === "string" ? answer : JSON.stringify(answer)
    ).length;
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
        answer_tokens,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===================== Boot ===================== */
if (!process.env.VERCEL) {
  app.listen(PORT, async () => {
    console.log(`➡️ API listening on http://localhost:${PORT}`);
    // tạo index gợi ý (không bắt buộc; nếu đã có thì Mongo sẽ bỏ qua)
    try {
      const _db = await getDb();
      const jCol = _db.collection(process.env.MONGO_JOURNAL_COLLECTION || "journal");
      const cCol = _db.collection(process.env.MONGO_CONFERENCE_COLLECTION || "conference");
      // index mặc định _id đã có; thêm created_time nếu bạn hay sort theo field này
      jCol.createIndex({ created_time: -1 }).catch(() => {});
      cCol.createIndex({ created_time: -1 }).catch(() => {});
    } catch (e) {
      console.warn("⚠️ ensure indexes warning:", e?.message || e);
    }

    initEmbedding().catch((e) =>
      console.error("Embedding preload failed:", e.message)
    );
  });
}

export default app;
