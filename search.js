// Kết hợp logic tìm kiếm (conference/journal), đọc file, embedding (local Xenova hoặc fallback OpenAI)

process.env.TRANSFORMERS_CACHE = process.env.TRANSFORMERS_CACHE || "/tmp/transformers_cache";
process.env.HF_HUB_CACHE = process.env.HF_HUB_CACHE || "/tmp/hf_hub_cache";
process.env.HF_HOME = process.env.HF_HOME || "/tmp/hf_home";
process.env.XDG_CACHE_HOME = process.env.XDG_CACHE_HOME || "/tmp";
process.env.TMPDIR = process.env.TMPDIR || "/tmp";
process.env.HOME = process.env.HOME || "/tmp";

import { MongoClient } from "mongodb";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import fetch from "node-fetch";
import * as docx from "docx-parser";
import mammoth from "mammoth";
import { getDb } from "./db.js";

const client = new MongoClient(process.env.MONGODB_URI);
const dbName = process.env.MONGODB_DB || "fitneu";

// Giới hạn topK (có thể cấu hình qua .env)
const MAX_TOPK = parseInt(process.env.MAX_TOPK || "30", 10);

// Vector collection / fields
const VECTOR_INDEX_NAME = process.env.VECTOR_INDEX_FUND || "vector_index_fund";
const VECTOR_PATH = process.env.VECTOR_PATH || "vector";
const MONGO_COLLECTION = process.env.MONGO_COLLECTION || "fund";

let embedder = null;
let usingRemoteEmbed = false;

/**
 * Try to initialize local embedder (Xenova). If it fails -> mark to use remote.
 * dynamic import to allow setting env vars first.
 */
export async function initEmbedding() {
  if (embedder || usingRemoteEmbed) return true;

  if (String(process.env.USE_REMOTE_EMBEDDING || "").toLowerCase() === "true") {
    usingRemoteEmbed = true;
    console.info("ℹ️ Using remote embedding (forced by USE_REMOTE_EMBEDDING=true)");
    return true;
  }

  const model = process.env.EMBEDDING_MODEL || "Xenova/paraphrase-multilingual-mpnet-base-v2";
  const modelName = model.startsWith("Xenova/") ? model : `Xenova/${model}`;

  try {
    console.log(`⏳ Attempting to load JS embedding model: ${modelName}`);

    const transformers = await import("@xenova/transformers");
    try {
      if (transformers && transformers.env) {
        transformers.env.cacheDir = process.env.TRANSFORMERS_CACHE || "/tmp/transformers_cache";
        transformers.env.useFSCache = true;
      }
    } catch (ee) {
      // ignore
    }

    const { pipeline } = transformers;
    embedder = await pipeline("feature-extraction", modelName);
    console.log("✅ Embedder ready (local Xenova)");
    return true;
  } catch (err) {
    console.warn("⚠️ Failed to init local embedder, will fallback to remote embeddings if available.", err?.message || err);
    usingRemoteEmbed = true;
    return true;
  }
}

/**
 * Remote embedding (OpenAI) fallback
 */
async function remoteEmbeddingOpenAI(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("No OPENAI_API_KEY provided for remote embedding.");

  const body = {
    model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    input: text,
  };

  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenAI embed failed: ${resp.status} ${txt}`);
  }

  const j = await resp.json();
  const vec = j.data && j.data[0] && j.data[0].embedding;
  if (!vec) throw new Error("Invalid embedding response from OpenAI");
  return vec;
}

/**
 * Sinh vector embedding từ text
 * - nếu có embedder local thì dùng, nếu không dùng OpenAI (nếu có API key)
 */
async function embed(text) {
  if (!embedder && !usingRemoteEmbed) {
    await initEmbedding();
  }

  if (embedder) {
    try {
      const out = await embedder(text, { pooling: "mean", normalize: true });
      return Array.from(out.data);
    } catch (e) {
      console.warn("⚠️ Local embedder failed during embed(), switching to remote:", e?.message || e);
      usingRemoteEmbed = true;
      embedder = null;
    }
  }

  try {
    return await remoteEmbeddingOpenAI(text);
  } catch (e) {
    console.error("❌ Remote embedding also failed:", e?.message || e);
    throw e;
  }
}

export async function embedText(text) {
  return embed(text);
}

/**
 * Đọc nội dung từ file path hoặc URL
 * Hỗ trợ: .pdf, .docx, .txt
 */
export async function readFileContent(inputPathOrUrl) {
  // If it's a URL -> fetch into /tmp
  let tmpPath = null;
  let buffer = null;

  if (typeof inputPathOrUrl === "string" && (inputPathOrUrl.startsWith("http://") || inputPathOrUrl.startsWith("https://"))) {
    const resp = await fetch(inputPathOrUrl);
    if (!resp.ok) {
      throw new Error(`Failed to fetch ${inputPathOrUrl}: ${resp.status}`);
    }
    const ab = await resp.arrayBuffer();
    buffer = Buffer.from(ab);
    tmpPath = path.join("/tmp", `${Date.now()}_${path.basename(new URL(inputPathOrUrl).pathname)}`);
    await fs.writeFile(tmpPath, buffer);
  }

  const filePath = tmpPath || inputPathOrUrl;
  const ext = (path.extname(String(filePath)) || "").toLowerCase();

  if (ext === ".pdf") {
    const dataBuffer = buffer || await fs.readFile(filePath);
    try {
      // dynamic import to avoid pdf-parse module init reading test files in serverless env
      const { default: pdfParse } = await import("pdf-parse");
      const pdf = await pdfParse(dataBuffer);
      return pdf.text || "";
    } catch (e) {
      console.error("❌ pdfParse error in readFileContent:", e);
      throw e;
    }
  } else if (ext === ".docx") {
    const dataBuffer = buffer || await fs.readFile(filePath);
    const { value } = await mammoth.extractRawText({ buffer: dataBuffer });
    return value || "";
  } else {
    const txt = await fs.readFile(filePath, "utf8");
    return txt || "";
  }
}

/**
 * Đọc nội dung .docx từ URL (dùng docx-parser fallback)
 * @param {string} url
 * @returns {Promise<string>} text content
 */
export async function readDocxFromUrl(url) {
  try {
    console.log(`📄 Đang tải nội dung file từ: ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`❌ Lỗi tải file: ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();

    const tempPath = `/tmp/${Date.now()}_temp.docx`;
    await fs.writeFile(tempPath, Buffer.from(arrayBuffer));

    const text = await new Promise((resolve, reject) => {
      docx.parseDocx(tempPath, (data) => {
        if (!data) reject("❌ Không thể đọc nội dung file");
        else resolve(data);
      });
    });

    console.log("✅ Đọc file thành công, độ dài:", text.length);
    return text;
  } catch (err) {
    console.error("⚠️ Lỗi khi đọc file docx:", err);
    return "";
  }
}

/**
 * Upload filePathOrUrl -> đọc -> embed -> lưu Mongo
 * - filePathOrUrl có thể là đường dẫn local hoặc URL (http/https)
 */
export async function uploadAndIndexFile(filePathOrUrl) {
  const db = await getDb();
  const col = db.collection(MONGO_COLLECTION);

  const content = await readFileContent(filePathOrUrl);
  if (!content || !content.trim()) {
    throw new Error("❌ File rỗng hoặc không đọc được nội dung.");
  }

  const vector = await embed(content);

  const doc = {
    text: content.slice(0, 20000), // lưu giới hạn
    [VECTOR_PATH]: vector,
    source: filePathOrUrl,
    uploadedAt: new Date(),
  };

  const result = await col.insertOne(doc);
  console.log(`✅ File đã được index vào MongoDB với _id=${result.insertedId}`);
  return result;
}

/**
 * Vector search trên collection 'fund'
 */
export async function fundVectorSearch(query, topk = 5) {
  const db = await getDb();
  const col = db.collection(MONGO_COLLECTION);

  const queryVector = await embed(query);
  const safeTopK = Math.min(Number(topk) || 5, MAX_TOPK);

  console.log(`🔎 Querying with vector length: ${queryVector.length}, topK=${safeTopK}`);

  const pipelineAgg = [
    {
      $vectorSearch: {
        index: VECTOR_INDEX_NAME,
        path: VECTOR_PATH,
        queryVector,
        numCandidates: safeTopK * 10,
        limit: safeTopK,
        similarity: "cosine",
      },
    },
    {
      $project: {
        [VECTOR_PATH]: 0,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];

  const items = await col.aggregate(pipelineAgg).toArray();

  if (!items || items.length === 0) {
    console.warn("⚠️ No results found for query:", query);
    return [];
  }

  return items.map((d) => ({
    ...d,
    _id: String(d._id),
  }));
}

// --- search for conferences & journals (alias) ---
export async function search({ question, topk = 5 }) {
  await client.connect();
  const dbCli = client.db(dbName);

  const queryVector = await embed(question);
  const safeTopK = Math.min(Number(topk) || 5, MAX_TOPK);

  const confResults = await dbCli.collection("conference").aggregate([
    {
      $vectorSearch: {
        index: "vector_index_conference",
        path: "vector",
        queryVector,
        numCandidates: 100,
        limit: safeTopK,
        similarity: "cosine",
      },
    },
    {
      $project: {
        _id: 0,
        vector: 0,
        created_time: 0,
        modified_time: 0,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ]).toArray();

  const journalResults = await dbCli.collection("journal").aggregate([
    {
      $vectorSearch: {
        index: "vector_index_journal",
        path: "vector",
        queryVector,
        numCandidates: 100,
        limit: safeTopK,
        similarity: "cosine",
      },
    },
    {
      $project: {
        _id: 0,
        vector: 0,
        created_time: 0,
        modified_time: 0,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ]).toArray();

  return {
    conference: confResults,
    journal: journalResults,
  };
}

export async function conferenceVectorSearch(question, topk = 5) {
  const result = await search({ question, topk });
  return result.conference;
}

export async function journalVectorSearch(question, topk = 5) {
  const result = await search({ question, topk });
  return result.journal;
}
