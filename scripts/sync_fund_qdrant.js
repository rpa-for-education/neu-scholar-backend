// scripts/sync_fund_qdrant.js

import { MongoClient } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import axios from "axios";
import { v5 as uuidv5 } from "uuid";
import "dotenv/config";

// ================= CONFIG =================
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "fitneu";

const QDRANT_URL = process.env.QDRANT_URL;
const COLLECTION = "fund_vectors";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const MODEL = process.env.OLLAMA_EMBEDDING_MODEL;

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
    title: doc["OPPORTUNITY TITLE"],
    amount: doc["ESTIMATED TOTAL FUNDING"],
    deadline: doc["ESTIMATED APPLICATION DUE DATE"],
  });
}

// ================= EMBEDDING =================
async function embed(text) {
  const res = await axios.post(`${OLLAMA_BASE}/api/embed`, {
    model: MODEL,
    input: text,
  });

  return res.data?.embeddings?.[0];
}

// ================= MAIN =================
async function main() {
  await mongo.connect();
  const db = mongo.db(DB_NAME);

  console.log("🚀 Incremental sync FUND...");

  const docs = await db.collection("fund").find({}).toArray();

  let updated = 0;
  let skipped = 0;

  for (const doc of docs) {
    const id = qid(doc._id);
    const hash = buildHash(doc);

    // 🔥 check existing
    const existing = await qdrant.retrieve(COLLECTION, {
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

    const text = `
${doc["OPPORTUNITY TITLE"]}
${doc["AGENCY NAME"]}
${doc["FUNDING DESCRIPTION"]}
`;

    const vector = await embed(text);

    if (!vector || vector.length !== VECTOR_SIZE) continue;

    await qdrant.upsert(COLLECTION, {
      points: [
        {
          id,
          vector,
          payload: {
            title: doc["OPPORTUNITY TITLE"],
            agency: doc["AGENCY NAME"],
            text: doc["FUNDING DESCRIPTION"],
            deadline: doc["ESTIMATED APPLICATION DUE DATE"],
            amount: doc["ESTIMATED TOTAL FUNDING"],
            url: doc["OPPORTUNITY URL"],
            hash,
          },
        },
      ],
    });

    updated++;
  }

  console.log(`🎯 DONE → updated=${updated} | skipped=${skipped}`);

  await mongo.close();
}

main();