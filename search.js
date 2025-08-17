// search.js
import { MongoClient } from "mongodb";
import { pipeline } from "@xenova/transformers";
import axios from "axios";
import "dotenv/config";

// --- MongoDB Singleton ---
let _client;
let _db;
async function getDb() {
  if (!_db) {
    _client = new MongoClient(process.env.MONGODB_URI);
    await _client.connect();
    _db = _client.db(process.env.MONGODB_DB || "rpa");
    console.log(`✅ MongoDB connected (search.js) → DB: ${_db.databaseName}`);
  }
  return _db;
}

// --- Embedding Model Singleton (local HuggingFace) ---
let _embedderPromise;
async function getLocalEmbedder() {
  if (!_embedderPromise) {
    console.log("⏳ Loading embedding model: Xenova/all-MiniLM-L6-v2");
    _embedderPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    console.log("✅ Embedding model ready (local)");
  }
  return _embedderPromise;
}

function flattenEmbedding(result) {
  if (!result) return [];
  if (result.data) return Array.from(result.data);
  if (Array.isArray(result[0]?.data)) return Array.from(result[0].data);
  if (Array.isArray(result[0])) return result[0].flat();
  if (Array.isArray(result)) return result;
  return [];
}

// --- Embed text ---
async function embedText(text) {
  const provider = process.env.DEFAULT_LLM_PROVIDER || "qwen";

  // --- Qwen embedding ---
  if (provider === "qwen") {
    try {
      const resp = await axios.post(
        `${process.env.QWEN_BASE_URL}/embeddings`,
        {
          model: "text-embedding-v2",
          input: text,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.QWEN_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
      return resp.data.data[0].embedding;
    } catch (err) {
      console.error("❌ Qwen Embedding error:", err.response?.data || err.message);
    }
  }

  // --- OpenAI embedding ---
  if (provider === "openai") {
    try {
      const resp = await axios.post(
        "https://api.openai.com/v1/embeddings",
        {
          model: "text-embedding-3-small",
          input: text,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
      return resp.data.data[0].embedding;
    } catch (err) {
      console.error("❌ OpenAI Embedding error:", err.response?.data || err.message);
    }
  }

  // --- Fallback local HuggingFace ---
  try {
    const embedder = await getLocalEmbedder();
    const out = await embedder(text, { pooling: "mean", normalize: true });
    return flattenEmbedding(out);
  } catch (err) {
    console.error("⚠️ Local embedding failed:", err.message);
    return [];
  }
}

// --- Cosine Similarity ---
function cosine(a, b) {
  let dot = 0.0, na = 0.0, nb = 0.0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// --- Fallback keyword rank ---
function fallbackRank(items, question, fieldExtractor) {
  return items
    .map(it => {
      const text = (fieldExtractor(it) || "").toLowerCase();
      const score = text.includes(question.toLowerCase()) ? 1 : 0;
      return { ...it, score };
    })
    .sort((a, b) => b.score - a.score);
}

// --- Safe rank (try embedding first) ---
async function safeRank(items, question, fieldExtractor) {
  try {
    const qVec = await embedText(question);
    return items
      .map(it => ({
        ...it,
        score: it.vector ? cosine(qVec, it.vector) : 0,
      }))
      .sort((a, b) => b.score - a.score);
  } catch (err) {
    console.error("⚠️ Embedding failed, fallback keyword:", err.message);
    return fallbackRank(items, question, fieldExtractor);
  }
}

// --- Search chính ---
export async function search(question, topk = 5) {
  const db = await getDb();

  if (/hội thảo|conference/i.test(question)) {
    const confs = await db.collection("conference").find().toArray();
    const ranked = await safeRank(confs, question, it => `${it.name} ${it.location} ${it.topics}`);
    return { type: "conference", results: ranked.slice(0, topk) };
  }

  if (/tạp chí|journal/i.test(question)) {
    const journals = await db.collection("journal").find().toArray();
    const ranked = await safeRank(journals, question, it => `${it.title} ${it.areas} ${it.categories}`);
    return { type: "journal", results: ranked.slice(0, topk) };
  }

  return { type: "unknown", results: [] };
}

export async function conferenceVectorSearch(question, topk = 5) {
  const db = await getDb();
  const confs = await db.collection("conference").find().toArray();
  const ranked = await safeRank(confs, question, it => `${it.name} ${it.location} ${it.topics}`);
  return ranked.slice(0, topk);
}

export async function journalVectorSearch(question, topk = 5) {
  const db = await getDb();
  const journals = await db.collection("journal").find().toArray();
  const ranked = await safeRank(journals, question, it => `${it.title} ${it.areas} ${it.categories}`);
  return ranked.slice(0, topk);
}
