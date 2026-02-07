// search.js

process.env.TRANSFORMERS_CACHE = process.env.TRANSFORMERS_CACHE || "/tmp/transformers_cache";
process.env.HF_HUB_CACHE = process.env.HF_HUB_CACHE || "/tmp/hf_hub_cache";
process.env.HF_HOME = process.env.HF_HOME || "/tmp/hf_home";
process.env.XDG_CACHE_HOME = process.env.XDG_CACHE_HOME || "/tmp";
process.env.TMPDIR = process.env.TMPDIR || "/tmp";
process.env.HOME = process.env.HOME || "/tmp";

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import fetch from "node-fetch";
import * as docx from "docx-parser";
import mammoth from "mammoth";
import { getDb } from "./db.js";

const MAX_TOPK = parseInt(process.env.MAX_TOPK || "30", 10);
const VECTOR_PATH = process.env.VECTOR_PATH || "vector";
const MONGO_COLLECTION = process.env.MONGO_COLLECTION || "fund";

let embedder = null;
let usingRemoteEmbed = false;

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
    } catch (ee) { }
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

export async function readFileContent(inputPathOrUrl) {
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

export async function uploadAndIndexFile(filePathOrUrl) {
  const db = await getDb();
  const col = db.collection(MONGO_COLLECTION);
  const content = await readFileContent(filePathOrUrl);
  if (!content || !content.trim()) {
    throw new Error("❌ File rỗng hoặc không đọc được nội dung.");
  }
  const vector = await embed(content);
  const doc = {
    text: content.slice(0, 20000),
    [VECTOR_PATH]: vector,
    source: filePathOrUrl,
    uploadedAt: new Date(),
  };
  const result = await col.insertOne(doc);
  console.log(`✅ File đã được index vào MongoDB với _id=${result.insertedId}`);
  return result;
}

// Thêm hàm tìm kiếm vector file upload
const FILES_COLLECTION = process.env.FILES_COLLECTION || "uploaded_files";
const VECTOR_INDEX_UPLOADED_FILES = "vector_index_uploaded_files";
export async function uploadedFilesVectorSearch(query, topk = 5) {
  const db = await getDb();
  const col = db.collection(FILES_COLLECTION);
  const queryVector = await embedText(query);
  const safeTopK = Math.min(Number(topk) || 5, MAX_TOPK);

  const pipeline = [
    {
      $vectorSearch: {
        index: VECTOR_INDEX_UPLOADED_FILES,
        path: "vector",
        queryVector,
        numCandidates: safeTopK * 10,
        limit: safeTopK,
        similarity: "cosine",
      },
    },
    {
      $project: {
        vector: 0,
        name: 1,
        text: 1,
        url: 1,
        uploadedAt: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];
  const results = await col.aggregate(pipeline).toArray();
  return results.map(d => ({
    ...d,
    _id: String(d._id)
  }));
}

// =============================
// SEARCH CONFERENCE + JOURNAL
// (PRE-FILTER CONTINENT / YEAR)
// =============================
export async function searchConferenceJournalByVector({
  vector,
  topk = 5,

  continent = null,
  country_code = null,
  year = null
}) {
  const db = await getDb();
  const k = Math.min(Number(topk) || 5, MAX_TOPK);

  /* =========================
   * BUILD FILTER
   * ========================= */
  const vectorFilter = {};

  // 1️⃣ Country (ưu tiên cao nhất)
  if (Array.isArray(country_code) && country_code.length > 0) {
    vectorFilter.country_code = { $in: country_code };
  } else if (typeof country_code === "string") {
    vectorFilter.country_code = country_code;
  }

  // 2️⃣ Continent (fallback)
  else if (continent) {
    vectorFilter.continent = continent;
  }

  // 3️⃣ Year
  if (year) {
    preMatch.start_date = {
      $gte: `${year}-01-01`,
      $lt: `${Number(year) + 1}-01-01`
    };
  }


  /* =========================
   * VECTOR SEARCH STAGE
   * ========================= */
  const vectorStage = {
    $vectorSearch: {
      index: "vector_index_conference",
      path: "vector",
      queryVector: vector,
      numCandidates: Math.max(20, k * 5),
      limit: k,
      similarity: "cosine",
    },
  };

  // 🔥 CHỈ add filter khi CÓ điều kiện
  if (Object.keys(vectorFilter).length > 0) {
    vectorStage.$vectorSearch.filter = vectorFilter;
  }

  /* =========================
   * PIPELINE
   * ========================= */
  const conferencePipeline = [
    vectorStage,
    {
      $project: {
        score: { $meta: "vectorSearchScore" },
        name: 1,
        acronym: 1,
        deadline: 1,
        start_date: 1,
        location: 1,
        city: 1,
        country: 1,
        country_code: 1,
        continent: 1,
        topics: 1,
        url: 1,
      },
    },
  ];

  const journalPipeline = [
    {
      $vectorSearch: {
        index: "vector_index_journal",
        path: "vector",
        queryVector: vector,
        numCandidates: Math.max(50, k * 10),
        limit: k,
        similarity: "cosine",
      },
    },
    {
      $project: {
        score: { $meta: "vectorSearchScore" },
        title: 1,
        publisher: 1,
        areas: 1,
        categories: 1,
        issn: 1,
        scimago_link: 1,
      },
    },
  ];

  const [conferences, journals] = await Promise.all([
    db.collection("conference").aggregate(conferencePipeline).toArray(),
    db.collection("journal").aggregate(journalPipeline).toArray(),
  ]);

  return { conferences, journals };
}





export async function uploadedFilesVectorSearchByVector(queryVector, topk = 5) {
  const db = await getDb();
  const col = db.collection(FILES_COLLECTION);
  const k = Math.min(Number(topk) || 5, MAX_TOPK);

  const pipeline = [
    {
      $vectorSearch: {
        index: VECTOR_INDEX_UPLOADED_FILES,
        path: "vector",
        queryVector,
        numCandidates: k * 10,
        limit: k,
        similarity: "cosine",
      },
    },
    {
      $project: {
        vector: 0,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];

  return await col.aggregate(pipeline).toArray();
}
