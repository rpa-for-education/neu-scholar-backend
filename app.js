import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import multer from "multer";
import fs from "fs";
import mammoth from "mammoth";
import fetch from "node-fetch";

import axios from "axios";
import { callLLM, modelMap } from "./llm.js";
import {
  initEmbedding,
  embedText,
  readDocxFromUrl,
  uploadedFilesVectorSearch,
  searchConferenceJournalByVector
} from "./search.js";
import {
  detectDomain,
  analyzeQuestion,
  buildSemanticQuery,
  applyFilters,
  rankResults,
  finalizeResults
} from "./agentReasoning.js";
import { getDb } from "./db.js";
import { encode } from "gpt-tokenizer";
// import { addMemory, getMemory } from "./memory.js";
import { s3Client } from "./s3.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";

const app = express();
const PORT = process.env.PORT || 8014;
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
  let context = `
BẠN LÀ AI AGENT TƯ VẤN HỌC THUẬT
CHUYÊN VỀ HỘI THẢO & TẠP CHÍ KHOA HỌC

ĐỐI TƯỢNG PHỤC VỤ:
- Giảng viên đại học
- Nghiên cứu sinh
- Học viên cao học

MỤC TIÊU:
- Tư vấn lựa chọn hội thảo hoặc tạp chí phù hợp cho công bố khoa học

NGUYÊN TẮC BẮT BUỘC (KHÔNG ĐƯỢC VI PHẠM):
1. Chỉ sử dụng dữ liệu được cung cấp bên dưới
2. Không sử dụng kiến thức bên ngoài
3. Không bịa hội thảo hoặc tạp chí
4. Không suy đoán
5. Nếu dữ liệu không đủ → phải nói rõ

CÂU TRẢ LỜI CHỈ ĐƯỢC PHÉP DỰA TRÊN DỮ LIỆU SAU
`;

  // =====================
  // CONFERENCES
  // =====================
  if (conferences.length > 0) {
    context += `
================================
DANH SÁCH HỘI THẢO
================================
`;
    conferences.forEach((c, i) => {
      context += `
[C${i + 1}]
Tên hội thảo: ${c.name || c.title || "Không có"}
Acronym: ${c.acronym || "Không có"}
Chủ đề: ${c.topics || "Không có"}
Hạn nộp bài: ${c.deadline || "Không có"}
Thời gian tổ chức: ${c.start_date || "Không có"}
Địa điểm tổ chức:
- Thành phố: ${c.city || c.location || "Không xác định"}
- Quốc gia: ${c.country || "Không xác định"}
- Khu vực: ${c.continent || "Không xác định"}
Website: ${c.url || "Không có"}
`;
    });
  }

  // =====================
  // JOURNALS
  // =====================
  if (journals.length > 0) {
    context += `
================================
DANH SÁCH TẠP CHÍ
================================
`;
    journals.forEach((j, i) => {
      context += `
[J${i + 1}]
Tên tạp chí: ${j.title || "Không có"}
Nhà xuất bản: ${j.publisher || "Không có"}
Lĩnh vực: ${j.areas || "Không có"}
Danh mục / Quartile: ${j.categories || "Không có"}
ISSN: ${j.issn || "Không có"}
Scimago Link: ${j.scimago_link || "Không có"}
`;
    });
  }

  // =====================
  // QUESTION & OUTPUT CONTRACT
  // =====================
  context += `
================================
CÂU HỎI
================================
${question}

================================
YÊU CẦU BẮT BUỘC VỀ CÂU TRẢ LỜI
================================
- Trả lời bằng tiếng Việt
- Văn phong học thuật
- Rõ ràng, ngắn gọn, có lập luận

BẮT BUỘC TRÍCH DẪN & LINK:
- Khi đề cập tạp chí → [J1], [J2], ... và PHẢI phải kèm link Scimago Link, click được
- Khi đề cập hội thảo → [C1], [C2], ... và PHẢI phải kèm link Website, click được

BẮT BUỘC CUỐI CÂU TRẢ LỜI:
- Phải có mục "Nguồn tham khảo"
- Mỗi [Jx], [Cx] phải kèm link tương ứng
- KHÔNG được gộp link, KHÔNG được viết chung chung

CẤU TRÚC CÂU TRẢ LỜI BẮT BUỘC (TRÌNH BÀY MARKDOWN):

**1. Nhận định tổng quan**
- Viết thành đoạn văn hoàn chỉnh

**2. Phân tích / tư vấn cụ thể**
- Mỗi hội thảo / tạp chí là 1 gạch đầu dòng
- Khi nhắc đến phải trích dẫn [C1], [J1] tương ứng
- Link phải click được

**3. Kết luận**
- 2–3 câu, tóm tắt lựa chọn phù hợp

**4. Nguồn tham khảo**
- Liệt kê theo dạng:
  - [C1] Tên hội thảo – Website
  - [J1] Tên tạp chí – Scimago Link

YÊU CẦU TRÌNH BÀY:
- BẮT BUỘC dùng Markdown
- Đề mục chính PHẢI in đậm (**)
- Mỗi đề mục chính xuống dòng rõ ràng
- Không gộp các đề mục

KHÔNG ĐƯỢC:
- Suy đoán
- Viết ngoài dữ liệu
- Mở rộng sang kiến thức chung
- Viết lan man
`;

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

// ============================= METADATA =============================
const MODEL_META = {
  "gpt-smart": { name: "GPT Smart", description: "Cân bằng chất lượng và chi phí, phù hợp tác vụ tổng hợp" },
  "gpt-fast": { name: "GPT Fast", description: "Tốc độ nhanh, chi phí thấp, phù hợp tác vụ hàng ngày" },
  "gemini-smart": { name: "Gemini Smart", description: "Hiệu suất ổn định, tốc độ cao, phù hợp chatbot và workflow" },
  "gemini-fast": { name: "Gemini Fast", description: "Độ trễ thấp, chi phí tối ưu, phù hợp xử lý khối lượng lớn" },
};

const METADATA_DATA = {
  name: "Hội thảo, Tạp chí",
  description:
    "Tìm kiếm, hỏi đáp, tổng hợp các cơ hội công bố các sản phẩm khoa học trên các Hội thảo, Tạp chí,... trong nước và quốc tế uy tín nhằm phục vụ hoạt động nghiên cứu khoa học của cán bộ, giảng viên, học viên,... của Đại học Kinh tế Quốc dân",
  version: "1.2.0",
  developer: "Nhóm thầy V Huy, V Minh, X Lâm",
  capabilities: ["search", "explain", "summarize"],
  sample_prompts: [
    "Hội thảo liên quan tới các công nghệ mới nổi như AI, Big Data, BlockChain, v.v...",
    "Các hội thảo quốc tế được tổ chức tại Trung Quốc trong năm 2026",
    "Tạp chí phù hợp với lĩnh vực Hệ thống thông tin quản lý",
    "Danh sách các tạp chí phù hợp với lĩnh vực Kinh tế bền vững?",
  ],
  provided_data_types: [
    { type: "conferences", description: "Danh sách hội thảo trong nước và quốc tế mà NEU Research Agent đang lưu trữ" },
    { type: "journals", description: "Danh sách tạp chí trong nước và quốc tế mà NEU Research Agent đang lưu trữ" },
  ],
  contact: "kcntt@neu.edu.vn",
  status: "active",
};

function handleMetadata(req, res, path) {
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
  const supported_models = Object.entries(modelMap).map(([model_id, { provider, model }]) => ({
    model_id,
    provider,
    model,
    name: (MODEL_META[model_id] || {}).name || model_id,
    description: (MODEL_META[model_id] || {}).description || "",
  }));
  res.json({
    ok: true,
    status: 200,
    url: `${baseUrl}${path}`,
    data: { ...METADATA_DATA, supported_models },
  });
}

app.get("/api/metadata", (req, res) => handleMetadata(req, res, "/api/metadata"));
app.get("/v1/metadata", (req, res) => handleMetadata(req, res, "/v1/metadata"));

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

// ============================= SHARED: Agent query (vector + LLM) =============================
async function runAgentQuery(question, model_id = DEFAULT_MODEL_ID, topk = 10) {
  const start = Date.now();
  const domain = detectDomain(question);
  const analysis = analyzeQuestion(question);
  const semanticQuery = buildSemanticQuery(analysis, domain);
  const queryVector = await embedText(semanticQuery);

  const year = analysis.wantsRecent ? String(analysis.wantsRecent[0]) : null;
  let { conferences, journals } = await searchConferenceJournalByVector({
    vector: queryVector,
    topk: 50,
    continent: analysis.wantsContinent,
    country_code: analysis.wantsCountryCode,
    year,
  });

  journals = journals.map((j) => ({ ...j, scimago_link: j.scimago_link ?? null }));
  conferences = conferences.map((c) => ({ ...c, url: c.url ?? null }));

  if (domain === "journal" || domain === "both") {
    journals = finalizeResults(
      rankResults(applyFilters(journals, analysis, "journal"), "journal"),
      Number(topk)
    );
  } else {
    journals = [];
  }

  if (domain === "conference" || domain === "both") {
    conferences = finalizeResults(
      rankResults(applyFilters(conferences, analysis, "conference"), "conference"),
      Number(topk)
    );
  } else {
    conferences = [];
  }

  const contextPrompt = buildPrompt(question, conferences, journals);
  const llmResult = await callLLM(contextPrompt, model_id);
  const answerText = typeof llmResult?.answer === "string" ? llmResult.answer : JSON.stringify(llmResult?.answer ?? llmResult);

  return {
    answerText,
    conferences,
    journals,
    domain,
    analysis,
    semanticQuery,
    responseTimeMs: Date.now() - start,
  };
}

// AGENT API
app.post("/api/agent", async (req, res) => {
  const start = Date.now();

  try {
    const {
      question,
      model_id = DEFAULT_MODEL_ID,
      topk = 10,
      file_name,
      session_id
    } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ error: "Missing question" });
    }

    const result = await runAgentQuery(question, model_id, topk);

    const col = await getCollection("chatlogs");
    await col.insertOne({
      question,
      answer: result.answerText,
      domain: result.domain,
      analysis: result.analysis,
      semanticQuery: result.semanticQuery,
      model_id,
      session_id,
      createdAt: new Date(),
      responseTimeMs: result.responseTimeMs
    });

    return res.json({
      model_id,
      answer: result.answerText,
      retrieved: {
        conferences: result.conferences,
        journals: result.journals
      },
      domain: result.domain,
      analysis: result.analysis,
      responseTimeMs: result.responseTimeMs
    });

  } catch (err) {
    console.error("❌ AGENT ERROR:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============================= AI PORTAL /ask (Agent contract) =============================
// Request: { session_id, model_id, user, prompt } — Response: { session_id, status: "success", content_markdown }
async function handleAsk(req, res) {
  let body;
  try {
    body = req.body;
  } catch {
    return res.status(400).json({
      session_id: null,
      status: "error",
      error_code: "INVALID_JSON",
      error_message: "Payload không phải JSON hợp lệ",
    });
  }

  const { session_id, model_id, user, prompt } = body;
  const question = prompt || body.question;

  if (!question || !String(question).trim()) {
    return res.status(400).json({
      session_id: session_id ?? null,
      status: "error",
      error_code: "INVALID_REQUEST",
      error_message: "Thiếu prompt hoặc question",
    });
  }

  try {
    const topk = Number(body.topk) || 10;
    const m = model_id || DEFAULT_MODEL_ID;

    const result = await runAgentQuery(question, m, topk);

    const sources = [
      ...result.journals.map((j) => ({
        type: "journal",
        title: j.title || j.name,
        publisher: j.publisher,
      })),
      ...result.conferences.map((c) => ({
        type: "conference",
        title: c.name || c.title,
        location: c.country || c.city,
      })),
    ].filter((s) => s.title);

    return res.json({
      session_id: session_id ?? null,
      status: "success",
      content_markdown: result.answerText,
      answer: result.answerText,
      sources,
      meta: {
        response_time_ms: result.responseTimeMs,
        domain: result.domain,
      },
    });
  } catch (err) {
    console.error("❌ ASK ERROR:", err);
    return res.status(500).json({
      session_id: session_id ?? null,
      status: "error",
      error_message: err?.message || "Internal server error",
    });
  }
}

app.post("/ask", (req, res) => handleAsk(req, res));
app.post("/v1/ask", (req, res) => handleAsk(req, res));


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
