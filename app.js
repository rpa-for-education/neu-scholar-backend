import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import multer from "multer";
import fs from "fs";
import mammoth from "mammoth";
import fetch from "node-fetch";

import axios from "axios";
import { callLLM } from "./llm.js";
import {
  initEmbedding,
  embedText,
  readDocxFromUrl,
  uploadedFilesVectorSearch,
  searchConferenceJournalByVector
} from "./search.js";
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
const DEFAULT_SHORT_MEMORY = 10;
const FILES_COLLECTION = process.env.FILES_COLLECTION || "uploaded_files";
const MAX_SHORT_HISTORY = 5;

app.use(cors());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fitsecret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);
app.use(express.json({ limit: "50mb" }));

app.use((req, _res, next) => {
  console.log("📩 Request:", { method: req.method, url: req.url });
  next();
});

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

function buildPrompt(question, conferences = [], journals = []) {
  let context = "Bạn là trợ lý học thuật, trả lời ngắn gọn, trích dẫn tên hội thảo/tạp chí liên quan.\n\n";

  if (conferences.length) {
    context += "Danh sách hội thảo:\n";
    conferences.slice(0, 5).forEach((c, i) => {
      context += `Hội thảo ${i + 1}: \n- Tên: ${c.name || c.title || "Không có"} \n- Acronym: ${c.acronym || "Không có"} \n- Địa điểm: ${c.location || "Không có"} \n- Hạn nộp: ${c.deadline || "Không có"} \n- Ngày tổ chức: ${c.start_date || "Không có"} \n- Chủ đề: ${c.topics || "Không có"} \n- Link: ${c.url || "Không có"}\n\n`;
    });
  } else {
    context += "Không có hội thảo phù hợp.\n\n";
  }

  if (journals.length) {
    context += "Danh sách tạp chí:\n";
    journals.slice(0, 5).forEach((j, i) => {
      context += `Tạp chí ${i + 1}: \n- Tên: ${j.title || "Không có"} \n- Nhà xuất bản: ${j.publisher || "Không có"} \n- Lĩnh vực: ${j.areas || "Không có"} \n- Danh mục: ${j.categories || "Không có"} \n- ISSN: ${j.issn || "Không có"}\n\n`;
    });
  } else {
    context += "Không có tạp chí phù hợp.\n\n";
  }

  context += `\nCâu hỏi: ${question}\n\nHãy trả lời bằng tiếng Việt hoặc ngôn ngữ của câu hỏi.`;
  return context;
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
      try {
        await s3Client.send(
          new PutObjectCommand({
            Bucket: process.env.MINIO_BUCKET_NAME,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
          })
        );
      } catch (err) {
        console.error("❌ S3 upload failed:", err);
      }
      const fileUrl = `http://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}/${process.env.MINIO_BUCKET_NAME}/${encodeURIComponent(
        key
      )}`;
      let extractedText = "";
      if (ext === ".pdf") {
        try {
          const { default: pdfParse } = await import("pdf-parse");
          const data = await pdfParse(file.buffer);
          extractedText = data.text || "";
        } catch (e) {
          console.error("❌ pdfParse error:", e);
        }
      } else if (ext === ".docx") {
        try {
          const buffer = file.buffer;
          const { value } = await mammoth.extractRawText({ buffer });
          extractedText = value || "";
        } catch (e) {
          console.error("❌ mammoth docx parse error:", e);
        }
      } else if (ext === ".txt") {
        extractedText = file.buffer.toString("utf8");
      }
      try {
        const embedding = extractedText.trim() ? await embedText(extractedText) : null;
        await fileCol.insertOne({
          name: uniqueName,
          url: fileUrl,
          text: extractedText,
          vector: embedding,
          uploadedAt: new Date(),
        });
      } catch (e) {
        console.error("❌ Indexing uploaded file failed:", e);
      }
      uploadedUrls.push(fileUrl);
    }
    res.json({ status: "success", files: uploadedUrls });
  } catch (err) {
    console.error("❌ Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================= SEARCH VECTOR FILE UPLOAD API =============================
app.post("/api/search_files", async (req, res) => {
  try {
    const { query, topk } = req.body;
    if (!query) return res.status(400).json({ error: "Missing query" });
    const results = await uploadedFilesVectorSearch(query, topk || 5);
    res.json({ results });
  } catch (err) {
    console.error("❌ search_files error:", err);
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

// The rest of your original journal, conference, and agent APIs remain unchanged

// Journals CRUD
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

// Conferences CRUD
app.get("/api/conferences", async (req, res) => {
  try {
    const col = await Conferences();
    const cursor = col
      .find({}, { projection: { _id: 0, name: 1, url: 1 } })
      .sort({ created_time: -1 })
      .limit(DEFAULT_LIMIT_CONFERENCE)
      .batchSize(500);
    const items = [];
    await cursor.forEach((item) => {
      items.push(item);
    });
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

// AGENT API
app.post("/api/agent", async (req, res) => {
  const start = Date.now();
  try {
    if (!db) db = await getDb();
    const fileCol = db.collection(FILES_COLLECTION);
    const { question, model_id = DEFAULT_MODEL_ID, topk = 5, file_name } = req.body;
    if (!question || !question.trim()) {
      return res.status(400).json({ error: "Missing question" });
    }
    const sessionId = req.body.session_id;

    // lấy short-term memory từ DB
    // const memoryEntries = await getMemory(sessionId, DEFAULT_SHORT_MEMORY);

    // memory lâu dài từ DB
    // const persistentMemory = await getMemory(sessionId, DEFAULT_SHORT_MEMORY);

    const k = Math.max(1, Math.min(parseInt(topk, 10) || 5, 50));
    let conferences = [];
    let journals = [];
    let fileHits = [];
    let fileContext = "";

    try {
      // embed đúng 1 lần
      const queryVector = await embedText(question);

      // search conference + journal chung
      const result = await searchConferenceJournalByVector({
        vector: queryVector,
        topk: k
      });

      conferences = result.conferences || [];
      journals = result.journals || [];

    } catch (e) {
      console.error("❌ vector search error:", e);
    }
    console.log("🔎 VECTOR SEARCH RESULT", {
      conferences: conferences.length,
      journals: journals.length,
    });

    if (conferences.length === 0 && journals.length === 0) {
      try {
        const articles = await fetchArticles();
        conferences = articles.slice(0, Number(k));
      } catch (e) {
        console.error("fetchArticles error:", e);
      }
    }
    if (Array.isArray(file_name) && file_name.length > 0) {
      for (const link of file_name) {
        const existing = await fileCol.findOne({ url: link });
        if (!existing) {
          const processed = await processFileUrl(link);
          if (processed) {
            try {
              await fileCol.insertOne({ ...processed, uploadedAt: new Date() });
            } catch (e) {
              console.error("Insert file to DB failed:", e);
            }
          }
        }
      }
      const foundFiles = await fileCol.find({ url: { $in: file_name } }).toArray();
      fileContext = foundFiles.map((f, i) => `${i + 1}. ${f.name} - ${f.url}`).join("\n");
      fileHits = foundFiles.slice(0, k);
    }
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
    
    await addMemory(sessionId, "user", question);
    await addMemory(sessionId, "assistant", answer);

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

async function fetchArticles() {
  try {
    const res = await axios.get(process.env.API_RESEARCH);
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.error("❌ fetchArticles error:", err.message);
    return [];
  }
}

async function processFileUrl(fileUrl) {
  try {
    const resp = await fetch(fileUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ext = fileUrl.toLowerCase().endsWith(".pdf")
      ? ".pdf"
      : fileUrl.toLowerCase().endsWith(".docx")
      ? ".docx"
      : ".txt";

    let extractedText = "";
    if (ext === ".pdf") {
      try {
        const { default: pdfParse } = await import("pdf-parse");
        const data = await pdfParse(buffer);
        extractedText = data.text || "";
      } catch (e) {
        console.error("❌ pdfParse error:", e);
        extractedText = "";
      }
    } else if (ext === ".docx") {
      try {
        extractedText = (await mammoth.extractRawText({ buffer })).value || "";
      } catch (e) {
        console.error("❌ mammoth extract error:", e);
        try {
          extractedText = await readDocxFromUrl(fileUrl);
        } catch (fallbackErr) {
          console.error("❌ readDocxFromUrl fallback error:", fallbackErr);
          extractedText = "";
        }
      }
    } else {
      extractedText = buffer.toString("utf8");
    }
    const embedding = extractedText.trim() ? await embedText(extractedText) : null;
    return { name: fileUrl.split("/").pop(), url: fileUrl, text: extractedText, vector: embedding };
  } catch (err) {
    console.error("processFileUrl error:", fileUrl, err);
    return null;
  }
}

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
