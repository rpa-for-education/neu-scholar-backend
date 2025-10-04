import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import multer from "multer";
import fs from "fs";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";
import fetch from "node-fetch";

import axios from "axios";
import { callLLM } from "./llm.js";
import { journalVectorSearch, conferenceVectorSearch, initEmbedding, embedText, readDocxFromUrl } from "./search.js";
import { getDb } from "./db.js";
import { encode } from "gpt-tokenizer";
import { addMemory, getMemory } from "./memory.js";
import { s3Client } from "./s3.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { ObjectId } from "mongodb";

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
app.use(express.json({ limit: "10mb" }));

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

      await s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.MINIO_BUCKET_NAME,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        })
      );

      const fileUrl = `http://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}/${process.env.MINIO_BUCKET_NAME}/${encodeURIComponent(key)}`;

      let extractedText = "";
      if (ext === ".pdf") {
        const data = await pdfParse(file.buffer);
        extractedText = data.text || "";
      } else if (ext === ".docx") {
        const { value } = await mammoth.extractRawText({ buffer: file.buffer });
        extractedText = value || "";
      } else if (ext === ".txt") {
        extractedText = file.buffer.toString("utf8");
      }

      if (extractedText.trim()) {
        const embedding = await embedText(extractedText);
        await fileCol.insertOne({
          name: uniqueName,
          url: fileUrl,
          text: extractedText,
          vector: embedding,
          uploadedAt: new Date(),
        });
      }

      uploadedUrls.push(fileUrl);
    }

    res.json({ status: "success", files: uploadedUrls });
  } catch (err) {
    console.error("❌ Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    db: db ? "connected" : "disconnected",
    time: new Date().toISOString(),
  });
});

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
    const col = await Conferences();
    const result = await col.findOneAndDelete({ _id: new ObjectId(req.params.id) });
    if (!result.value) return res.status(404).json({ error: "Conference not found" });
    res.json({ message: "Conference deleted", deleted: result.value });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete conference", detail: err.message });
  }
});

// ============================= AGENT HANDLER =============================
app.post("/api/agent", async (req, res) => {
  const start = Date.now();

  try {
    if (!db) db = await getDb();
    const fileCol = db.collection(FILES_COLLECTION);

    const { question, model_id = DEFAULT_MODEL_ID, topk = 5, file_name } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ error: "Missing question" });
    }

    const k = Math.max(1, Math.min(parseInt(topk, 10) || 5, 50));
    let conferences = [];
    let journals = [];
    let hits = [];
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

    // ✅ XỬ LÝ FILE LINK
    try {
      if (Array.isArray(file_name) && file_name.length > 0) {
        for (const link of file_name) {
          const existing = await fileCol.findOne({ url: link });
          if (!existing) {
            try {
              console.log("📄 Đang tải file:", link);
              const resp = await fetch(link);
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

              const buffer = Buffer.from(await resp.arrayBuffer());
              const ext = link.toLowerCase().endsWith(".pdf")
                ? ".pdf"
                : link.toLowerCase().endsWith(".docx")
                ? ".docx"
                : ".txt";

              let extractedText = "";

              if (ext === ".pdf") {
                const data = await pdfParse(buffer);
                extractedText = data.text || "";
              } else if (ext === ".docx") {
                const { value } = await mammoth.extractRawText({ buffer });
                extractedText = value || "";
              } else {
                extractedText = buffer.toString("utf8");
              }

              if (extractedText.trim()) {
                const embedding = await embedText(extractedText);
                await fileCol.insertOne({
                  name: link.split("/").pop(),
                  url: link,
                  text: extractedText,
                  vector: embedding,
                  uploadedAt: new Date(),
                });
              }
            } catch (fetchErr) {
              console.error("❌ Không thể đọc file link:", link, fetchErr);
            }
          }
        }

        const foundFiles = await fileCol.find({ url: { $in: file_name } }).toArray();

        fileContext = foundFiles.map((f, i) => `${i + 1}. ${f.name} - ${f.url}`).join("\n");

        fileHits = foundFiles.slice(0, k);
      } else {
        fileHits = [];
        fileContext = "";
      }
    } catch (e) {
      console.error("❌ Lỗi xử lý file links:", e);
      fileHits = [];
      fileContext = "";
    }

    // Lấy short-term memory
    let memoryEntries = [];
    if (Array.isArray(req.body.chat_history)) {
      const recentHistory = req.body.chat_history.slice(-MAX_SHORT_HISTORY * 2);
      memoryEntries = recentHistory
        .map((entry) => ({ role: entry.role || "user", text: entry.content || "" }))
        .filter((m) => m.text.trim().length > 0);
    }

    const memoryText = memoryEntries.map((m) => `- [${m.role}] ${m.text}`).join("\n");

    let contextText = journals
      .map(
        (f, i) =>
          `${i + 1}. ${f.title || ""} - ${f.publisher || ""} - ${f.url || ""}`
      )
      .join("\n");

    if (fileContext.trim()) {
      fileContext = `Dưới đây là các file người dùng đã tải lên có liên quan:\n${fileContext}\n\n`;
    }

    const promptText = `
Người dùng hỏi: "${question}"

${memoryText ? "Ngữ cảnh hội thoại gần đây:\n" + memoryText + "\n\n" : ""}
Dưới đây là danh sách journals/conferences có liên quan:
${contextText}

${fileContext}Hãy trả lời bằng tiếng Việt, trích dẫn tên journal/conference hoặc file và đường dẫn.
Nếu không có dữ liệu phù hợp thì hãy nói rõ ràng "Không tìm thấy dữ liệu phù hợp".
`;

    console.log("=== PROMPT ===\n", promptText, "\n=== END PROMPT ===");

    const llmRes = await callLLM(promptText, model_id);

    let text = "";
    let provider = null;
    if (typeof llmRes === "string") text = llmRes;
    else if (llmRes && typeof llmRes === "object") {
      text = llmRes.answer ?? llmRes.text ?? llmRes.content ?? "";
      provider = llmRes.provider ?? null;
    }

    text = formatAnswerText(text);

    let prompt_tokens = null,
      answer_tokens = null,
      tokens_used = null;
    try {
      prompt_tokens = encode(promptText).length;
      answer_tokens = encode(text).length;
      tokens_used = prompt_tokens + answer_tokens;
    } catch (_) {}

    const response_time_ms = Date.now() - start;

    return res.json({
      model_id,
      answer: text,
      retrieved: { journals: journals.slice(0, 5), files: fileHits.slice(0, 5) },
      memory: { entries_count: memoryEntries.length },
      meta: { response_time_ms, tokens_used, prompt_tokens, answer_tokens },
    });
  } catch (err) {
    console.error("❌ /api/agent error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
});

// ============================= SERVER STARTUP =============================
if (!process.env.VERCEL) {
  (async () => {
    try {
      db = await getDb();
      await initEmbedding();
      app.listen(PORT, () => console.log(`🚀 API running at http://localhost:${PORT}`));
    } catch (e) {
      console.error("❌ Startup error:", e);
      process.exit(1);
    }
  })();
}

export default app;