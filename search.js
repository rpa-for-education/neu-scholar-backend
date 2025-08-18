// backend/search.js
import OpenAI from "openai";
import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI);
const dbName = process.env.MONGODB_DB || "rpa";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ===== Hàm tạo embedding cho câu hỏi =====
async function embed(text) {
  const resp = await openai.embeddings.create({
    model: "sentence-transformers/all-MiniLM-L6-v2",
    input: text,
  });
  return resp.data[0].embedding;
}

// ===== Hàm tìm kiếm chung (conference + journal) =====
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
      $addFields: {
        score: { $meta: "vectorSearchScore" },
      },
    },
    {
      $project: {
        _id: 0,
        vector: 0,
        created_time: 0,
        modified_time: 0,
      },
    },
    { $sort: { score: -1 } },
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
      $addFields: {
        score: { $meta: "vectorSearchScore" },
      },
    },
    {
      $project: {
        _id: 0,
        vector: 0,
        created_time: 0,
        modified_time: 0,
      },
    },
    { $sort: { score: -1 } },
  ]).toArray();

  return {
    conference: confResults,
    journal: journalResults,
  };
}

// ===== Alias để app.js import không lỗi =====
export async function conferenceVectorSearch(question, topk = 5) {
  const result = await search({ question, topk });
  return result.conference;
}

export async function journalVectorSearch(question, topk = 5) {
  const result = await search({ question, topk });
  return result.journal;
}

export async function initEmbedding() {
  return true;
}
