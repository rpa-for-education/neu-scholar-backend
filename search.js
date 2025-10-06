// search.js
import { getDb } from "./db.js";
import { pipeline } from "@xenova/transformers";

// ================== GLOBAL CONFIG & CACHE ==================
let embedder = null;

/**
 * Khởi tạo model embedding (chỉ load 1 lần)
 * Model: paraphrase-multilingual-mpnet-base-v2 (768 chiều)
 */
export async function initEmbedding() {
  if (embedder) return embedder;

  console.log("🧠 Loading embedding model: Xenova/paraphrase-multilingual-mpnet-base-v2 ...");
  embedder = await pipeline("feature-extraction", "Xenova/paraphrase-multilingual-mpnet-base-v2", {
    quantized: true,
  });
  console.log("✅ Model loaded successfully (768 dimensions)");
  return embedder;
}

/**
 * Sinh vector embedding từ text
 * - Không dùng OpenAI API
 * - Giới hạn text dài để tránh quá tải bộ nhớ
 */
export async function embedText(text) {
  if (!text || typeof text !== "string") return null;
  await initEmbedding();

  // Cắt text quá dài để tránh tắc RAM
  const maxLen = 3000;
  const safeText =
    text.length > maxLen
      ? text.slice(0, maxLen / 2) + " ... " + text.slice(-maxLen / 2)
      : text;

  const start = Date.now();
  const out = await embedder(safeText, { pooling: "mean", normalize: true });
  const vector = Array.from(out.data);
  console.log(`⚡ Embedded (${vector.length} dims) in ${Date.now() - start} ms`);
  return vector;
}

/**
 * Thực hiện vector search chung
 */
async function vectorSearch(collectionName, query, limit = 5) {
  const db = await getDb();
  const collection = db.collection(collectionName);
  const queryVector = await embedText(query);
  if (!queryVector) return [];

  const pipelineStages = [
    {
      $vectorSearch: {
        queryVector,
        path: "vector",
        numCandidates: limit * 10,
        limit,
        index: `vector_index_${collectionName}`,
      },
    },
    {
      $project: {
        _id: 1,
        title: 1,
        name: 1,
        url: 1,
        publisher: 1,
        categories: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];

  const start = Date.now();
  const results = await collection.aggregate(pipelineStages).toArray();
  console.log(
    `🔍 Vector search on [${collectionName}] -> ${results.length} results (${Date.now() - start} ms)`
  );
  return results;
}

// ================== SEARCH WRAPPERS ==================
export async function journalVectorSearch(query, limit = 5) {
  return vectorSearch("journal", query, limit);
}

export async function conferenceVectorSearch(query, limit = 5) {
  return vectorSearch("conference", query, limit);
}

export async function uploadedFilesVectorSearch(query, limit = 5) {
  return vectorSearch("uploaded_files", query, limit);
}

// ================== DOCX READER (fallback) ==================
export async function readDocxFromUrl(fileUrl) {
  try {
    const resp = await fetch(fileUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();

    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return value || "";
  } catch (err) {
    console.error("❌ readDocxFromUrl error:", err);
    return "";
  }
}

export default {
  initEmbedding,
  embedText,
  journalVectorSearch,
  conferenceVectorSearch,
  uploadedFilesVectorSearch,
  readDocxFromUrl,
};
