import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import multer from "multer";
import fs from "fs";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import fetch from "node-fetch";

import axios from "axios";
import { callLLM } from "./llm.js";
import {
  journalVectorSearch,
  conferenceVectorSearch,
  initEmbedding,
  embedText,
  readDocxFromUrl,
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
app.use(express.json({ limit: "50mb" }));

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
          const data = await pdfParse(file.buffer);
          extractedText = data.text || "";
        } catch (e) {
          console.error("❌ pdfParse error:", e);
        }
      } else if (ext === ".docx") {
        try {
          const { value } = await mammoth.extractRawText({ buffer: file.buffer });
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

// ============================= HEALTH CHECK =============================
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    db: db ? "connected" : "disconnected",
    time: new Date().toISOString(),
  });
});

// ============================= FILE FROM URL LOGIC =============================
async function fetchAndEmbedFiles(fileUrls) {
  if (!Array.isArray(fileUrls) || fileUrls.length === 0) return [];

  if (!db) db = await getDb();
  const fileCol = db.collection(FILES_COLLECTION);
  const results = [];

  for (const link of fileUrls) {
    try {
      const existing = await fileCol.findOne({ url: link });
      if (existing) {
        results.push(existing);
        continue;
      }

      console.log("📄 Fetching file from URL:", link);
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
        try {
          const data = await pdfParse(buffer);
          extractedText = data.text || "";
        } catch (e) {
          console.error("pdf parse error:", e);
        }
      } else if (ext === ".docx") {
        try {
          const { value } = await mammoth.extractRawText({ buffer });
          extractedText = value || "";
        } catch (e) {
          console.error("mammoth error:", e);
          try {
            extractedText = await readDocxFromUrl(link);
          } catch {
            extractedText = "";
          }
        }
      } else {
        extractedText = buffer.toString("utf8");
      }

      const embedding = extractedText.trim() ? await embedText(extractedText) : null;
      const doc = {
        name: link.split("/").pop(),
        url: link,
        text: extractedText,
        vector: embedding,
        uploadedAt: new Date(),
      };
      await fileCol.insertOne(doc);
      results.push(doc);
    } catch (err) {
      console.error("❌ Failed to fetch/embed file:", link, err);
    }
  }

  return results;
}

// ============================= AGENT =============================
async function fetchArticles() {
  try {
    const res = await axios.get(process.env.API_RESEARCH);
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.error("❌ fetchArticles error:", err.message);
    return [];
  }
}

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

// ============================= AGENT ENDPOINT =============================
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

    if (Array.isArray(file_name) && file_name.length > 0) {
      const fetchedFiles = await fetchAndEmbedFiles(file_name);
      fileHits = fetchedFiles.slice(0, k);
      fileContext = fetchedFiles.map((f, i) => `${i + 1}. ${f.name} - ${f.url}`).join("\n");
      if (fileContext.trim()) {
        fileContext = `Dưới đây là các file người dùng đã tải lên có liên quan:\n${fileContext}\n\n`;
      }
    }

    // Short-term memory
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
