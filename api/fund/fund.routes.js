import express from "express";
import axios from "axios";
import { QdrantClient } from "@qdrant/js-client-rest";

const router = express.Router();

// ================= CONFIG =================
const QDRANT_URL = process.env.QDRANT_URL;
const COLLECTION = "fund_vectors";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const EMBED_MODEL = process.env.OLLAMA_EMBEDDING_MODEL;

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  checkCompatibility: false,
});

// ================= EMBED =================
async function embed(text) {
  const res = await axios.post(`${OLLAMA_BASE}/api/embed`, {
    model: EMBED_MODEL,
    input: text,
  });

  return res.data?.embeddings?.[0] || res.data?.embedding;
}

// ================= SEARCH =================
async function searchFund(query, topk = 5) {
  const vector = await embed(query);

  const result = await qdrant.search(COLLECTION, {
    vector,
    limit: topk,
    with_payload: true,
  });

  return result.map((r) => ({
    score: r.score,
    ...r.payload,
  }));
}

// ================= ROUTES =================

// 🔥 POST /api/fund/ask
router.post("/ask", async (req, res) => {
  try {
    const { question, topk = 5 } = req.body;

    if (!question) {
      return res.status(400).json({ error: "Missing question" });
    }

    const data = await searchFund(question, topk);

    res.json({
      type: "fund",
      total: data.length,
      data,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// (optional) giữ endpoint cũ
router.post("/", async (req, res) => {
  req.url = "/ask";
  router.handle(req, res);
});

export default router;