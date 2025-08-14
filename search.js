// search.js (tối ưu)
import "dotenv/config";
import express from "express";
import { MongoClient } from "mongodb";
import { pipeline } from "@xenova/transformers";

const router = express.Router();

// ===== ENV =====
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "rpa";
const ENV_JOURNAL_INDEX = (process.env.JOURNAL_VECTOR_INDEX || "").trim();
const ENV_CONFERENCE_INDEX = (process.env.CONFERENCE_VECTOR_INDEX || "").trim();

// ===== MongoDB Singleton =====
let _client;
let _db;
async function getDb() {
  if (!_db) {
    _client = new MongoClient(MONGODB_URI);
    await _client.connect();
    _db = _client.db(MONGODB_DB);
    console.log(`✅ MongoDB connected (search.js) → DB: ${MONGODB_DB}`);
  }
  return _db;
}

// ===== Embedding Model Singleton =====
let _embedderPromise;
async function getEmbedder() {
  if (!_embedderPromise) {
    console.log("⏳ Loading embedding model: Xenova/all-MiniLM-L6-v2...");
    _embedderPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return _embedderPromise;
}

function toArrayLike(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.flat(Infinity);
  if (v.data) return Array.from(v.data);
  return [];
}

async function getQueryVector(q) {
  try {
    const emb = await (await getEmbedder())(q, { pooling: "mean", normalize: true });
    const arr = toArrayLike(emb);
    return arr.length ? arr : null;
  } catch (e) {
    console.error("❌ Embedding error:", e.message);
    return null;
  }
}

// ===== Field & Index Detection =====
const FIELD_CACHE = new Map();
const candidateVectorFields = ["vector", "embedding"];

async function pickVectorField(db, collection) {
  if (FIELD_CACHE.has(collection)) return FIELD_CACHE.get(collection);

  for (const field of candidateVectorFields) {
    const hit = await db.collection(collection).findOne(
      { [field]: { $type: "array" } },
      { projection: { _id: 1 } }
    );
    if (hit) {
      FIELD_CACHE.set(collection, field);
      return field;
    }
  }
  FIELD_CACHE.set(collection, "vector"); // fallback default
  return "vector";
}

function candidateIndexNames(collection) {
  const envName =
    collection === "journal" ? ENV_JOURNAL_INDEX :
    collection === "conference" ? ENV_CONFERENCE_INDEX : "";
  const cands = [];
  if (envName) cands.push(envName);
  cands.push(`${collection}_vector_index`, "vector_index");
  return [...new Set(cands)];
}

// ===== Text Fallback =====
async function textSearch(db, collection, q, limit) {
  const regex = new RegExp(q, "i");
  const orFields = [
    "title", "name", "categories", "areas", "publisher", "issn",
    "search_keywords", "topics", "acronym", "location", "country"
  ];

  const filter = { $or: orFields.map(f => ({ [f]: regex })) };
  return db.collection(collection).find(filter).limit(limit).toArray();
}

// ===== Vector Search =====
async function tryVectorOnce(db, collection, indexName, path, qv, limit) {
  const projection = {
    _id: 1,
    score: { $meta: "vectorSearchScore" },
    title: 1, name: 1, acronym: 1, location: 1, issn: 1,
    publisher: 1, country: 1, categories: 1, areas: 1,
    rank: 1, sjr: 1, h_index: 1, deadline: 1, start_date: 1,
    url: 1, topics: 1,
  };

  const agg = [
    {
      $vectorSearch: {
        index: indexName,
        path,
        queryVector: qv,
        numCandidates: Math.max(100, limit * 5),
        limit,
      },
    },
    { $project: projection },
  ];

  return db.collection(collection).aggregate(agg).toArray();
}

async function vectorSearch(collection, q, limit = 5) {
  const db = await getDb();
  const n = Math.max(1, Number(limit) || 5);

  if (!q?.trim()) {
    // nếu không có từ khoá → trả về mới nhất
    return db.collection(collection).find({})
      .sort({ _id: -1 })
      .limit(n)
      .toArray();
  }

  const qv = await getQueryVector(q);
  if (qv) {
    const path = await pickVectorField(db, collection);
    const indexes = candidateIndexNames(collection);

    for (const idx of indexes) {
      try {
        const rs = await tryVectorOnce(db, collection, idx, path, qv, n);
        if (rs.length) return rs;
      } catch (e) {
        // ignore and try next index
      }
    }
  }

  console.warn(`⚠️ Using text fallback for '${collection}' (q='${q}')`);
  return textSearch(db, collection, q, n);
}

// ===== Public API =====
export async function journalVectorSearch(q, limit = 10) {
  return vectorSearch("journal", q, limit);
}
export async function conferenceVectorSearch(q, limit = 10) {
  return vectorSearch("conference", q, limit);
}

// ===== Express Routes =====
router.get("/journals", async (req, res) => {
  res.json(await journalVectorSearch(req.query.q || "", req.query.limit || 10));
});
router.get("/conferences", async (req, res) => {
  res.json(await conferenceVectorSearch(req.query.q || "", req.query.limit || 10));
});
router.get("/search/all", async (req, res) => {
  const limit = req.query.limit || 10;
  const q = req.query.q || "";
  const [journals, conferences] = await Promise.all([
    journalVectorSearch(q, limit),
    conferenceVectorSearch(q, limit)
  ]);
  res.json({ journals, conferences });
});

export default router;
