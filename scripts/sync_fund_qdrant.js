import { MongoClient } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import axios from "axios";
import { v5 as uuidv5 } from "uuid";
import PQueue from "p-queue";
import "dotenv/config";

// ================= CONFIG =================
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "fitneu";

const COLLECTION = "fund_vectors";
const QDRANT_URL = process.env.QDRANT_URL;

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const MODEL = process.env.OLLAMA_EMBEDDING_MODEL;

const UUID_NAMESPACE = uuidv5.URL;

const BATCH_SIZE = 64;
const CONCURRENCY = 5;
const RETRY = 2;

// ================= INIT =================
const mongo = new MongoClient(MONGODB_URI);

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  checkCompatibility: false,
});

const queue = new PQueue({ concurrency: CONCURRENCY });

// ================= UTILS =================
function qid(key) {
  return uuidv5(String(key), UUID_NAMESPACE);
}

function buildHash(doc) {
  return JSON.stringify({
    title: doc["OPPORTUNITY TITLE"],
    amount: doc["ESTIMATED TOTAL FUNDING"],
    deadline: doc["ESTIMATED APPLICATION DUE DATE"],
  });
}

function buildText(doc) {
  return [
    doc["OPPORTUNITY TITLE"],
    doc["AGENCY NAME"],
    doc["FUNDING DESCRIPTION"],
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .trim();
}

// ================= EMBEDDING =================
async function embed(text, retry = RETRY) {
  try {
    const res = await axios.post(`${OLLAMA_BASE}/api/embed`, {
      model: MODEL,
      input: text,
    });

    const vec = res.data?.embeddings?.[0];

    if (!vec) throw new Error("No embedding");

    return vec;

  } catch (err) {
    if (retry > 0) return embed(text, retry - 1);

    console.error("❌ Embed failed");
    return null;
  }
}

// ================= ENSURE COLLECTION =================
async function ensureCollection(vectorSize) {
  try {
    await qdrant.getCollection(COLLECTION);
    console.log("✅ Collection exists");
  } catch {
    console.log("🚀 Creating collection...");

    await qdrant.createCollection(COLLECTION, {
      vectors: {
        size: vectorSize,
        distance: "Cosine",
      },
    });

    console.log("✅ Created");
  }
}

// ================= MAIN =================
async function main() {
  await mongo.connect();
  const db = mongo.db(DB_NAME);

  console.log("🚀 PRODUCTION SYNC START");

  const cursor = db.collection("fund").find({});
  const batch = [];

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  // 👉 detect vector size 1 lần
  const testVec = await embed("test");
  const VECTOR_SIZE = testVec.length;

  await ensureCollection(VECTOR_SIZE);

  while (await cursor.hasNext()) {
    const doc = await cursor.next();

    await queue.add(async () => {
      const id = qid(doc._id);
      const hash = buildHash(doc);

      // 🔥 skip nhanh (không retrieve từng cái nữa)
      // nếu muốn strict thì dùng payload index sau

      const text = buildText(doc);
      const vector = await embed(text);

      if (!vector) {
        processed++;
        return;
      }

      batch.push({
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
      });

      if (batch.length >= BATCH_SIZE) {
        await qdrant.upsert(COLLECTION, {
          points: batch.splice(0),
        });
        updated += BATCH_SIZE;
      }

      processed++;

      if (processed % 100 === 0) {
        console.log(`⚡ processed=${processed} updated=${updated}`);
      }
    });
  }

  await queue.onIdle();

  if (batch.length) {
    await qdrant.upsert(COLLECTION, { points: batch });
    updated += batch.length;
  }

  console.log("🎯 DONE", {
    processed,
    updated,
    skipped,
  });

  await mongo.close();
}

main();