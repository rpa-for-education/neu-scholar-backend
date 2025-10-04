import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import multer from "multer";
import fs from "fs";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";
import fetch from "node-fetch"; // ✅ fetch để tải file từ link

import axios from "axios";
import { callLLM } from "./llm.js";
import { journalVectorSearch, conferenceVectorSearch, initEmbedding, embedText } from "./search.js";
import { getDb } from "./db.js";
import { encode } from "gpt-tokenizer";
import { addMemory, getMemory } from "./memory.js";
import { s3Client } from "./s3.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";

const app = express();
const PORT = process.env.PORT || 4000;
const DEFAULT_MODEL_ID = "qwen-max";
const DEFAULT_LIMIT_JOURNAL = 100;
const DEFAULT_LIMIT_CONFERENCE = 100;
const FILES_COLLECTION = process.env.FILES_COLLECTION || "uploaded_files";
const MAX_SHORT_HISTORY = 5; // 5 cặp hỏi - đáp gần nhất

// ===== Middleware =====
app.use(cors());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fitsecret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);
app.use(express.json({ limit: "10mb" }));

app.use((req, _res, next) => {
  console.log("📩 Request:", { method: req.method, url: req.url });
  next();
});

// Format trả lời
function formatAnswerText(rawText) {
  if (!rawText) return "";
  let text = rawText.replace(/\*\*/g, "");
  text = text.replace(/(\d+)\.\s+/g, "\n- ");
  text = text.replace(/\n+/g, "\n\n");
  return text.trim();
}

function parseBool(v) {
  return String(v).toLowerCase() === "true";
}
function getProjection(includeVector) {
  return includeVector ? {} : { vector: 0 };
}

// MongoDB helpers
let db;
async function getCollection(name) {
  if (!db) db = await getDb();
  return db.collection(name);
}
async function Journals() {
  return getCollection("journal");
}
async function Conferences() {
  return getCollection("conference");
}

const upload = multer({ storage: multer.memoryStorage() });

// ============================= PROCESS FILE BUFFER =============================
async function processFileBuffer(fileBuffer, fileName, fileUrl, fileCol) {
  try {
    const ext = fileName.toLowerCase().endsWith(".pdf")
      ? ".pdf"
      : fileName.toLowerCase().endsWith(".docx")
      ? ".docx"
      : ".txt";

    let extractedText = "";

    if (ext === ".pdf") {
      const data = await pdfParse(fileBuffer);
      extractedText = data.text || "";
    } else if (ext === ".docx") {
      const { value } = await mammoth.extractRawText({ buffer: fileBuffer });
      extractedText = value || "";
    } else {
      extractedText = fileBuffer.toString("utf8");
    }

    if (extractedText.trim()) {
      const embedding = await embedText(extractedText);
      await fileCol.insertOne({
        name: fileName,
        url: fileUrl,
        text: extractedText,
        vector: embedding,
        uploadedAt: new Date(),
      });
    }

    return extractedText;
  } catch (err) {
    console.error(`❌ Không thể xử lý file ${fileName}:`, err);
    return "";
  }
}

// Xử lý file từ URL (file_name array trong /api/agent)
async function processFileLinks(file_name, fileCol, k) {
  const fileHits = [];
  let fileContext = "";

  if (!Array.isArray(file_name) || file_name.length === 0) return { fileHits, fileContext };

  for (const link of file_name) {
    const existing = await fileCol.findOne({ url: link });
    if (!existing) {
      try {
        console.log("📄 Đang tải file:", link);
        const resp = await fetch(link);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buffer = Buffer.from(await resp.arrayBuffer());
        const fileName = link.split("/").pop() || `file_${Date.now()}`;
        await processFileBuffer(buffer, fileName, link, fileCol);
      } catch (fetchErr) {
        console.error("❌ Không thể đọc file link:", link, fetchErr);
      }
    }
  }

  const foundFiles = await fileCol.find({ url: { $in: file_name } }).toArray();
  fileContext = foundFiles.map((f, i) => `${i + 1}. ${f.name} - ${f.url}`).join("\n");
  return { fileHits: foundFiles.slice(0, k), fileContext };
}

// ============================= UPLOAD FILE API =============================
app.post("/api/upload", upload.array("file"), async (req, res) => {
  try {
    const { folder, userEmail } = req.body;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    if (!db) db = await getDb();
    const fileCol = db.collection(FILES_COLLECTION);
    const uploadedUrls = [];

    for (const file of req.files) {
      const parts = file.originalname.split(".");
      const ext = parts.length > 1 ? "." + parts.pop().toLowerCase() : "";
      const baseName = parts.join(".");
      const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "");
      const uniqueName = `${baseName}_${timestamp}${ext}`;
      const prefix = userEmail || folder || "";
      const key = prefix ? `${prefix}/${uniqueName}` : uniqueName;

      // upload to S3 / MinIO
      await s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.MINIO_BUCKET_NAME,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        })
      );

      const fileUrl = `http://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}/${process.env.MINIO_BUCKET_NAME}/${encodeURIComponent(key)}`;

      await processFileBuffer(file.buffer, uniqueName, fileUrl, fileCol);
      uploadedUrls.push(fileUrl);
    }

    res.json({ status: "success", files: uploadedUrls });
  } catch (err) {
    console.error("❌ Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================= HEALTH CHECK =============================
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    db: db ? "connected" : "disconnected",
    time: new Date().toISOString(),
  });
});

// ============================= JOURNALS CRUD =============================
app.get("/api/journals", async (req, res) => {
  try {
    const col = await Journals();
    const cursor = col
      .find({}, { projection: { title: 1, categories: 1, publisher: 1 } })
      .limit(DEFAULT_LIMIT_JOURNAL)
      .batchSize(1000);
    const items = [];
    await cursor.forEach((item) => {
      items.push({
        name: item.title,
        quartiles: item.categories,
        publisher: item.publisher,
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

// ============================= CONFERENCES CRUD =============================
app.get("/api/conferences", async (req, res) => {
  try {
    const col = await Conferences();
    const cursor = col
      .find({}, { projection: { _id: 0, name: 1, url: 1 } })
      .sort({ created_time: -1 })
      .limit(DEFAULT_LIMIT_CONFERENCE)
      .batchSize(500);
    const items = [];
    await cursor.forEach((item) => items.push(item));
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

// ============================= FETCH ARTICLES =============================
async function fetchArticles() {
  try {
    const res = await axios.get(process.env.API_RESEARCH);
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.error("❌ fetchArticles error:", err.message);
    return [];
  }
}

// ============================= BUILD PROMPT =============================
function buildPrompt(question, conferences = [], journals = []) {
  let context = "Bạn là trợ lý học thuật, trả lời ngắn gọn, trích dẫn tên hội thảo/tạp chí liên quan.\n\n";

  if (conferences.length) {
    context += "Danh sách hội thảo:\n";
    conferences.slice(0, 10).forEach((c, i) => {
      context += `Hội thảo ${i + 1}: \n- Tên: ${c.name || c.title || "Không có"} \n- Acronym: ${c.acronym || "Không có"} \n- Địa điểm: ${c.location || "Không có"} \n- Hạn nộp: ${c.deadline || "Không có"} \n- Ngày tổ chức: ${c.start_date || "Không có"} \n- Chủ đề: ${c.topics || "Không có"} \n- Link: ${c.url || "Không có"}\n\n`;
    });
  } else {
    context += "Không có hội thảo phù hợp.\n\n";
  }

  if (journals.length) {
    context += "Danh sách tạp chí:\n";
    journals.slice(0, 10).forEach((j, i) => {
      context += `Tạp chí ${i + 1}:\n- Tên: ${j.title || "Không có"} \n- Nhà xuất bản: ${j.publisher || "Không có"} \n- Lĩnh vực: ${j.areas || "Không có"} \n- Danh mục: ${j.categories || "Không có"} \n- ISSN: ${j.issn || "Không có"}\n\n`;
    });
  } else {
    context += "Không có tạp chí phù hợp.\n\n";
  }

  context += `\nCâu hỏi: ${question}\n\nHãy trả lời bằng tiếng Việt hoặc ngôn ngữ của câu hỏi.`;
  return context;
}

// ============================= AGENT API =============================
app.post("/api/agent", async (req, res) => {
  const start = Date.now();

  try {
    if (!db) db = await getDb();
    const fileCol = db.collection(FILES_COLLECTION);

    const { question, model_id = DEFAULT_MODEL_ID, topk = 5, file_name } = req.body;

    console.log(req.body);

    if (!question || !question.trim()) {
      return res.status(400).json({ error: "Missing question" });
    }

    const k = Math.max(1, Math.min(parseInt(topk, 10) || 5, 50));
    let conferences = [];
    let journals = [];
    let fileHits = [];
    let fileContext = "";

    try {
      conferences = await conferenceVectorSearch(question, Number(k));
    } catch (e) {
      console.error("conferenceVectorSearch error:", e);
    }

    try {
      journals = await journalVectorSearch(question, Number(k));
    } catch (e) {
      console.error("journalVectorSearch error:", e);
    }

    if (conferences.length === 0 && journals.length === 0) {
      try {
        const articles = await fetchArticles();
        conferences = articles.slice(0, Number(k));
      } catch (e) {
        console.error("fetchArticles error:", e);
      }
    }

    // ✅ XỬ LÝ FILE LINK
    const fileResult = await processFileLinks(file_name, fileCol, k);
    fileHits = fileResult.fileHits;
    fileContext = fileResult.fileContext;

    // Lấy short-term memory từ chat_history
    let memoryEntries = [];
    if (Array.isArray(req.body.chat_history)) {
      const recentHistory = req.body.chat_history.slice(-MAX_SHORT_HISTORY * 2);
      memoryEntries = recentHistory
        .map((entry) => ({
          role: entry.role || "user",
          text: entry.content || "",
        }))
        .filter((m) => m.text.trim().length > 0);
    }

    const memoryText = memoryEntries.map((m) => `- [${m.role}] ${m.text}`).join("\n");

    const contextPrompt = buildPrompt(question, conferences, journals);

    if (fileContext.trim()) {
      fileContext = `Dưới đây là các file người dùng đã tải lên có liên quan:\n${fileContext}\n\n`;
    }

    const finalPrompt = `
      ${contextPrompt}

      ${memoryText ? "Ngữ cảnh hội thoại gần đây:\n" + memoryText + "\n\n" : ""}

      ${fileContext}
    `;

    console.log("===== Prompt =====");
    console.log(finalPrompt);

    let answer;
    try {
      answer = await callLLM(finalPrompt, model_id);
    } catch (e) {
      console.error("callLLM error:", e);
      return res.status(500).json({ error: "Failed to call LLM service" });
    }

    if (typeof answer !== "string") {
      try {
        answer = JSON.stringify(answer);
      } catch {
        answer = "";
      }
    }
    answer = answer.trim();

    // Ghi log cuộc hội thoại
    try {
      const col = await getCollection("chatlogs");
      await col.insertOne({
        question,
        answer,
        sessionId: req.body.session_id,
        model_id,
        createdAt: new Date(),
        responseTimeMs: Date.now() - start,
      });
    } catch (e) {
      console.error("Log insert error:", e);
    }

    // Trả về câu trả lời cùng thông tin metadata
    return res.json({
      model_id,
      answer,
      retrieved: { conferences, journals, files: fileHits },
      memoryCount: memoryEntries.length,
      responseTimeMs: Date.now() - start,
    });
  } catch (err) {
    console.error("Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============================= START SERVER =============================
if (!process.env.VERCEL) {
  app.listen(PORT, async () => {
    console.log(`API listening on http://localhost:${PORT}`);
    try {
      await initEmbedding();
    } catch (e) {
      console.error("Embedding initialization error:", e);
    }
  });
}

export default app;
