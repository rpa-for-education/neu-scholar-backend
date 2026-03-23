import { MongoClient } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import axios from "axios";
import { v5 as uuidv5 } from "uuid";
import "dotenv/config";

let PQueue;
try {
  PQueue = (await import("p-queue")).default;
} catch {
  console.warn("⚠️ p-queue not installed → running sequentially");
}

// ================= CONFIG =================
const MONGODB_URI = process.env.MONGODB_URI || "";
const DB_NAME = process.env.MONGODB_DB || "fitneu";

const COLLECTION = "fund_vectors";
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

// ❗ FIX CỨNG MODEL
const MODEL = "qwen3-embedding:8b";

const UUID_NAMESPACE = uuidv5.URL;

const BATCH_SIZE = 64;
const CONCURRENCY = 5;
const RETRY = 2;

// ================= INIT =================
if (!MONGODB_URI) {
  console.error("❌ Missing MONGODB_URI");
  process.exit(1);
}

const mongo = new MongoClient(MONGODB_URI);

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  checkCompatibility: false,
});

const queue = PQueue
  ? new PQueue({ concurrency: CONCURRENCY })
  : {
      add: async (fn) => await fn(),
      onIdle: async () => {},
    };

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

    if (!vec) {
      console.error("❌ No embedding returned → check model:", MODEL);
      throw new Error("No embedding");
    }

    return vec;

  } catch (err) {
    if (retry > 0) return embed(text, retry - 1);

    console.error("❌ Embed failed:", err.message);
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

  console.log("🚀 SYNC FUND (qwen3-embedding)");

  const cursor = db.collection("fund").find({});
  const batch = [];

  let processed = 0;
  let updated = 0;

  const testVec = await embed("test");
  if (!testVec) {
    console.error("❌ Cannot get embedding → check Ollama model qwen3-embedding:8b");
    process.exit(1);
  }

  const VECTOR_SIZE = testVec.length;
  console.log("📐 VECTOR SIZE:", VECTOR_SIZE);

  await ensureCollection(VECTOR_SIZE);

  while (await cursor.hasNext()) {
    const doc = await cursor.next();

    await queue.add(async () => {
      try {
        const id = qid(doc._id);
        const text = buildText(doc);

        if (!text) return;

        const vector = await embed(text);
        if (!vector) return;

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
            hash: buildHash(doc),
          },
        });

        if (batch.length >= BATCH_SIZE) {
          const sending = batch.splice(0);
          await qdrant.upsert(COLLECTION, { points: sending });
          updated += sending.length;
        }

        processed++;

        if (processed % 100 === 0) {
          console.log(`⚡ processed=${processed} updated=${updated}`);
        }

      } catch (err) {
        console.error("❌ Doc error:", doc._id, err.message);
      }
    });
  }

  await queue.onIdle();

  if (batch.length) {
    await qdrant.upsert(COLLECTION, { points: batch });
    updated += batch.length;
  }

  console.log("🎯 DONE", { processed, updated });

  await mongo.close();
}

main();