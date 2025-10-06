// ==================== ENV CACHE CONFIG ====================
process.env.TRANSFORMERS_CACHE = process.env.TRANSFORMERS_CACHE || "/tmp/transformers_cache";
process.env.HF_HUB_CACHE = process.env.HF_HUB_CACHE || "/tmp/hf_hub_cache";
process.env.HF_HOME = process.env.HF_HOME || "/tmp/hf_home";
process.env.XDG_CACHE_HOME = process.env.XDG_CACHE_HOME || "/tmp";
process.env.TMPDIR = process.env.TMPDIR || "/tmp";
process.env.HOME = process.env.HOME || "/tmp";

import { MongoClient } from "mongodb";
import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";
import * as docx from "docx-parser";
import mammoth from "mammoth";
import { getDb } from "./db.js";

// ==================== CONSTANTS ====================
const client = new MongoClient(process.env.MONGODB_URI);
const dbName = process.env.MONGODB_DB || "fitneu";

const MAX_TOPK = parseInt(process.env.MAX_TOPK || "30", 10);
const VECTOR_PATH = process.env.VECTOR_PATH || "vector";
const VECTOR_INDEX_FUND = process.env.VECTOR_INDEX_FUND || "vector_index_fund";
const VECTOR_INDEX_UPLOADED = process.env.VECTOR_INDEX_UPLOADED || "vector_index_uploaded_files";
const COLLECTION_FUND = process.env.MONGO_COLLECTION || "fund";
const COLLECTION_UPLOADED = "uploaded_files";

// ==================== EMBEDDING SETUP ====================
let embedder = null;

/** Khởi tạo local embedder Xenova (768 chiều) */
export async function initEmbedding() {
  if (embedder) return true;
  const modelName = process.env.EMBEDDING_MODEL || "Xenova/paraphrase-multilingual-mpnet-base-v2";
  try {
    const transformers = await import("@xenova/transformers");
    transformers.env.cacheDir = process.env.TRANSFORMERS_CACHE || "/tmp/transformers_cache";
    const { pipeline } = transformers;
    embedder = await pipeline("feature-extraction", modelName);
    console.log("✅ Local Xenova embedder loaded (768 dimensions)");
    return true;
  } catch (err) {
    console.error("❌ Failed to init Xenova embedder:", err);
    throw err;
  }
}

/** Sinh vector embedding từ text */
export async function embedText(text) {
  if (!embedder) await initEmbedding();
  try {
    const out = await embedder(text, { pooling: "mean", normalize: true });
    const vector = Array.from(out.data);
    if (vector.length !== 768) {
      console.warn(`⚠️ Embedding dimension = ${vector.length}, expected 768`);
    }
    return vector;
  } catch (err) {
    console.error("❌ Embedding error:", err);
    throw err;
  }
}

// ==================== FILE READING ====================
export async function readFileContent(inputPathOrUrl) {
  let buffer = null;
  let tmpPath = null;

  if (inputPathOrUrl.startsWith("http://") || inputPathOrUrl.startsWith("https://")) {
    const res = await fetch(inputPathOrUrl);
    if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
    const ab = await res.arrayBuffer();
    buffer = Buffer.from(ab);
    tmpPath = path.join("/tmp", `${Date.now()}_${path.basename(new URL(inputPathOrUrl).pathname)}`);
    await fs.writeFile(tmpPath, buffer);
  }

  const filePath = tmpPath || inputPathOrUrl;
  const ext = path.extname(filePath).toLowerCase();
  const data = buffer || await fs.readFile(filePath);

  if (ext === ".pdf") {
    const { default: pdfParse } = await import("pdf-parse");
    const pdf = await pdfParse(data);
    return pdf.text || "";
  } else if (ext === ".docx") {
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return value || "";
  } else {
    return data.toString("utf8");
  }
}

export async function readDocxFromUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    const tmp = `/tmp/${Date.now()}.docx`;
    await fs.writeFile(tmp, Buffer.from(ab));
    const text = await new Promise((resolve, reject) =>
      docx.parseDocx(tmp, (data) => (data ? resolve(data) : reject("Empty data")))
    );
    return text;
  } catch (e) {
    console.error("readDocxFromUrl error:", e);
    return "";
  }
}

// ==================== UPLOAD & INDEX ====================
export async function uploadAndIndexFile(filePathOrUrl) {
  const db = await getDb();
  const col = db.collection(COLLECTION_UPLOADED);

  const content = await readFileContent(filePathOrUrl);
  if (!content.trim()) throw new Error("❌ File empty or unreadable");

  const vector = await embedText(content);
  const doc = {
    name: path.basename(filePathOrUrl),
    url: filePathOrUrl,
    text: content.slice(0, 20000),
    [VECTOR_PATH]: vector,
    uploadedAt: new Date(),
  };

  const res = await col.insertOne(doc);
  console.log(`✅ Indexed file: ${res.insertedId}`);
  return res;
}

// ==================== VECTOR SEARCH ====================
async function genericVectorSearch(collection, indexName, query, { limit = 5, filter = null } = {}) {
  const db = await getDb();
  const col = db.collection(collection);
  const queryVector = await embedText(query);
  const safeTopK = Math.min(Number(limit) || 5, MAX_TOPK);

  const pipeline = [
    {
      $vectorSearch: {
        index: indexName,
        path: VECTOR_PATH,
        queryVector,
        numCandidates: safeTopK * 10,
        limit: safeTopK,
        similarity: "cosine",
        filter: filter || undefined,
      },
    },
    {
      $project: {
        score: { $meta: "vectorSearchScore" },
        name: 1,
        text: { $substr: ["$text", 0, 400] },
        url: 1,
        uploadedAt: 1,
      },
    },
    { $sort: { score: -1, uploadedAt: -1 } },
  ];

  const results = await col.aggregate(pipeline).toArray();
  return results.map((r) => ({ ...r, score: parseFloat(r.score?.toFixed(4)) }));
}

export async function fundVectorSearch(query, limit = 5) {
  return genericVectorSearch(COLLECTION_FUND, VECTOR_INDEX_FUND, query, { limit });
}

export async function uploadedFileVectorSearch(query, limit = 5, filter = "") {
  const filterQuery = filter
    ? {
        $or: [
          { name: { $regex: filter, $options: "i" } },
          { text: { $regex: filter, $options: "i" } },
        ],
      }
    : null;
  return genericVectorSearch(COLLECTION_UPLOADED, VECTOR_INDEX_UPLOADED, query, {
    limit,
    filter: filterQuery,
  });
}

export async function searchConferenceAndJournal(question, topk = 5) {
  await client.connect();
  const dbCli = client.db(dbName);
  const qVec = await embedText(question);

  const searchAgg = (indexName) => [
    {
      $vectorSearch: {
        index: indexName,
        path: "vector",
        queryVector: qVec,
        numCandidates: 100,
        limit: topk,
        similarity: "cosine",
      },
    },
    {
      $project: {
        score: { $meta: "vectorSearchScore" },
        title: 1,
        abstract: 1,
      },
    },
  ];

  const [conf, journal] = await Promise.all([
    dbCli.collection("conference").aggregate(searchAgg("vector_index_conference")).toArray(),
    dbCli.collection("journal").aggregate(searchAgg("vector_index_journal")).toArray(),
  ]);

  return { conference: conf, journal };
}

export const conferenceVectorSearch = async (q, k = 5) =>
  (await searchConferenceAndJournal(q, k)).conference;

export const journalVectorSearch = async (q, k = 5) =>
  (await searchConferenceAndJournal(q, k)).journal;
