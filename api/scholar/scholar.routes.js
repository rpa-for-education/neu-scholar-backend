import express from "express";
import axios from "axios";
import { QdrantClient } from "@qdrant/js-client-rest";

const router = express.Router();

// ================= CONFIG =================
const QDRANT_URL = process.env.QDRANT_URL;
const COLLECTION = "scholar_vectors";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const EMBED_MODEL = process.env.OLLAMA_EMBEDDING_MODEL;

// ================= INIT =================
const qdrant = new QdrantClient({
  url: QDRANT_URL,
  checkCompatibility: false,
});

// ================= CACHE =================
const embedCache = new Map();

// ================= EMBED =================
async function embed(text) {
  if (embedCache.has(text)) {
    return embedCache.get(text);
  }

  const res = await axios.post(
    `${OLLAMA_BASE}/api/embed`,
    {
      model: EMBED_MODEL,
      input: text,
    },
    {
      timeout: 30000, // 🔥 tránh treo
    }
  );

  const vec =
    res.data?.embeddings?.[0] ||
    res.data?.embedding ||
    null;

  if (vec) embedCache.set(text, vec);

  return vec;
}

// ================= SEARCH =================
async function searchScholar(query, topk = 5) {
  const vector = await embed(query);
  if (!vector) return [];

  const result = await qdrant.search(COLLECTION, {
    vector,
    limit: Math.min(topk, 5), // 🔥 limit
    with_payload: true,
  });

  return result.map((r) => ({
    score: r.score,
    ...r.payload,
  }));
}

// ================= CORE =================
async function handleAsk(req, res) {
  try {
    const {
      question,
      prompt,
      query,
      message,
      topk
    } = req.body || {};

    const finalQuestion = (
      question ||
      prompt ||
      query ||
      message ||
      ""
    ).trim();

    if (!finalQuestion) {
      return res.status(400).json({
        error: "Missing question"
      });
    }

    const data = await searchScholar(finalQuestion, topk || 5);

    return res.json({
      type: "scholar",
      total: data.length,
      data,
    });

  } catch (err) {
    console.error("❌ Scholar error:", err);

    return res.status(200).json({
      success: false,
      error: err.message,
      data: []
    });
  }
}

// ================= ROUTES =================
router.post("/", handleAsk);
router.post("/ask", handleAsk);

export default router;