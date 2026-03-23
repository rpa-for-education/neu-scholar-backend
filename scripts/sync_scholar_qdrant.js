// scripts/sync_scholar_qdrant.js

import { MongoClient } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import axios from "axios";
import { v5 as uuidv5 } from "uuid";
import "dotenv/config";

// ================= CONFIG =================
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "fitneu";

const COLLECTION_NAME = "scholar"; // 👉 Mongo collection

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_COLLECTION = "scholar_vectors";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const EMBED_MODEL = process.env.OLLAMA_EMBEDDING_MODEL;

const VECTOR_SIZE = 4096;
const UUID_NAMESPACE = uuidv5.URL;

// ================= INIT =================
const mongo = new MongoClient(MONGODB_URI);

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  checkCompatibility: false,
});

// ================= UTILS =================
function qid(key) {
  return uuidv5(String(key), UUID_NAMESPACE);
}

// 🔥 detect change
function buildHash(doc) {
  return JSON.stringify({
    title: doc.title,
    abstract: doc.abstract,
    year: doc.year,
  });
}

// ================= BUILD TEXT =================
function buildText(doc) {
  return [
    doc.title,
    doc.abstract,
    doc.authors,
    doc.venue,
    doc.keywords,
  ]
    .filter(Boolean)
    .join(" ");
}

// ================= EMBEDDING =================
async function embed(text) {
  try {
    const res = await axios.post(`${OLLAMA_BASE}/api/embed`, {
      model: EMBED_MODEL,
      input: text,
    });

    const vec =
      res.data?.embeddings?.[0] ||
      res.data?.embedding ||
      null;

    if (!vec || vec.length !== VECTOR_SIZE) {
      throw new Error(`Invalid vector: ${vec?.length}`);
    }

    return vec;

  } catch (err) {
    console.error("❌ Embedding error:", err.message);
    return null;
  }
}

// ================= MAIN =================
async function main() {
  await mongo.connect();
  const db = mongo.db(DB_NAME);

  console.log("🚀 Incremental sync SCHOLAR...");

  const docs = await db.collection(COLLECTION_NAME).find({}).toArray();

  let updated = 0;
  let skipped = 0;

  for (const doc of docs) {
    try {
      const id = qid(doc._id);
      const hash = buildHash(doc);

      // 🔥 check existing
      const existing = await qdrant.retrieve(QDRANT_COLLECTION, {
        ids: [id],
        with_payload: true,
      });

      if (existing.length > 0) {
        const oldHash = existing[0].payload?.hash;

        if (oldHash === hash) {
          skipped++;
          continue;
        }
      }

      const text = buildText(doc);
      if (!text) continue;

      const vector = await embed(text);
      if (!vector) continue;

      await qdrant.upsert(QDRANT_COLLECTION, {
        points: [
          {
            id,
            vector,
            payload: {
              type: "scholar",

              title: doc.title,
              abstract: doc.abstract,
              authors: doc.authors,
              venue: doc.venue,
              year: doc.year,

              citations: doc.citations,
              url: doc.url,

              keywords: doc.keywords,
              text,

              hash, // 🔥 để incremental sync
            },
          },
        ],
      });

      updated++;

      if (updated % 50 === 0) {
        console.log(`✅ Updated: ${updated} | Skipped: ${skipped}`);
      }

    } catch (err) {
      console.log("❌ Skip doc:", doc._id);
    }
  }

  console.log(`🎯 DONE → updated=${updated} | skipped=${skipped}`);

  await mongo.close();
  console.log("🔌 Mongo closed");
}

main();