// backend/search.js
import { MongoClient } from "mongodb";
import { pipeline } from "@xenova/transformers";

const client = new MongoClient(process.env.MONGODB_URI);
const dbName = process.env.MONGODB_DB || "rpa";

// Khởi tạo embedder local
let embedder = null;
export async function initEmbedding() {   // 👈 export luôn từ đây
  if (!embedder) { 
    console.log("⏳ Loading local embedding model (paraphrase-multilingual-mpnet-base-v2, 768d)...");
    embedder = await pipeline("feature-extraction", "Xenova/paraphrase-multilingual-mpnet-base-v2");
    console.log("✅ Embedder ready");
  }
  return true;
}

// Hàm tạo embedding cho câu hỏi
async function embed(text) {
  if (!embedder) await initEmbedding();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

// Hàm tìm kiếm chung (conference + journal)
export async function search({ question, topk = 5 }) {
  await client.connect();
  const db = client.db(dbName);

  const queryVector = await embed(question);

  // --- Tìm trong collection conference ---
  const confResults = await db.collection("conference").aggregate([
    {
      $vectorSearch: {
        index: "vector_index_conference",
        path: "vector",
        queryVector,
        numCandidates: 100,
        limit: topk,
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

  // --- Tìm trong collection journal ---
  const journalResults = await db.collection("journal").aggregate([
    {
      $vectorSearch: {
        index: "vector_index_journal",
        path: "vector",
        queryVector,
        numCandidates: 100,
        limit: topk,
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

// Alias để app.js import
export async function conferenceVectorSearch(question, topk = 5) {
  const result = await search({ question, topk });
  return result.conference;
}

export async function journalVectorSearch(question, topk = 5) {
  const result = await search({ question, topk });
  return result.journal;
}