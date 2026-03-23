import { MongoClient } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import axios from "axios";
import { v5 as uuidv5 } from "uuid";
import fs from "fs";
import "dotenv/config";

// ================= P-QUEUE =================
let PQueue;
try {
  PQueue = (await import("p-queue")).default;
} catch {
  console.warn("⚠️ p-queue not installed → running sequentially");
}

// ================= CONFIG =================
const MONGODB_URI = process.env.MONGODB_URI || "";
const DB_NAME = process.env.MONGODB_DB || "fitneu";

const COLLECTION = "scholar_vectors";
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const MODEL = "qwen3-embedding:8b";

const UUID_NAMESPACE = uuidv5.URL;

const BATCH_SIZE = 64;
const CONCURRENCY = 8; // 🚀 tăng tốc
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

// ================= LOG FILE =================
const errorLog = fs.createWriteStream("journal_errors.log", { flags: "a" });

// ================= SAFE UTILS =================
function safe(val) {
  if (!val) return "";

  if (Array.isArray(val)) return val.join(" ");

  if (typeof val === "object") return JSON.stringify(val);

  return String(val);
}

function qid(key) {
  return uuidv5(String(key), UUID_NAMESPACE);
}

function buildHash(doc, type) {
  if (type === "conference") {
    return JSON.stringify({
      name: safe(doc.name),
      deadline: safe(doc.deadline),
    });
  }

  return JSON.stringify({
    title: safe(doc.title),
    quartile: safe(doc.sjr_best_quartile),
    sjr: safe(doc.sjr),
  });
}

// ================= BUILD TEXT =================
function buildConferenceText(doc) {
  return [
    safe(doc.name),
    safe(doc.acronym),
    safe(doc.topics),
    safe(doc.city),
    safe(doc.country),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .trim();
}

function buildJournalText(doc) {
  return [
    safe(doc.title),
    safe(doc.categories),
    safe(doc.areas),
    safe(doc.publisher),
    safe(doc.sjr_best_quartile),
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

// ================= UPSERT BATCH =================
async function flushBatch(batch, stats) {
  if (!batch.length) return;

  try {
    const sending = batch.splice(0);
    await qdrant.upsert(COLLECTION, { points: sending });
    stats.updated += sending.length;
  } catch (err) {
    console.error("❌ Qdrant upsert error:", err.message);
  }
}

// ================= MAIN =================
async function main() {
  await mongo.connect();
  const db = mongo.db(DB_NAME);

  console.log("🚀 SYNC SCHOLAR (OPTIMIZED)");

  const conferenceCursor = db.collection("conference").find({});
  const journalCursor = db.collection("journal").find({});

  const batch = [];

  const stats = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };

  // 👉 detect vector size
  const testVec = await embed("test scholar");
  if (!testVec) {
    console.error("❌ Cannot get embedding → check Ollama");
    process.exit(1);
  }

  const VECTOR_SIZE = testVec.length;
  console.log("📐 VECTOR SIZE:", VECTOR_SIZE);

  await ensureCollection(VECTOR_SIZE);

  // ================= CONFERENCE =================
  while (await conferenceCursor.hasNext()) {
    const doc = await conferenceCursor.next();

    await queue.add(async () => {
      try {
        const text = buildConferenceText(doc);
        if (!text) {
          stats.skipped++;
          return;
        }

        const vector = await embed(text);
        if (!vector) {
          stats.skipped++;
          return;
        }

        batch.push({
          id: qid(doc._id.toString()),
          vector,
          payload: {
            type: "conference",
            name: safe(doc.name),
            acronym: safe(doc.acronym),
            deadline: safe(doc.deadline),
            city: safe(doc.city),
            country: safe(doc.country),
            topics: safe(doc.topics),
            url: safe(doc.url),
            text,
            hash: buildHash(doc, "conference"),
          },
        });

        if (batch.length >= BATCH_SIZE) {
          await flushBatch(batch, stats);
        }

        stats.processed++;

        if (stats.processed % 100 === 0) {
          console.log(`⚡ processed=${stats.processed} updated=${stats.updated}`);
        }

      } catch (err) {
        stats.errors++;
        errorLog.write(`[CONF] ${doc._id} ${err.message}\n`);
      }
    });
  }

  // ================= JOURNAL =================
  while (await journalCursor.hasNext()) {
    const doc = await journalCursor.next();

    await queue.add(async () => {
      try {
        const text = buildJournalText(doc);
        if (!text) {
          stats.skipped++;
          return;
        }

        const vector = await embed(text);
        if (!vector) {
          stats.skipped++;
          return;
        }

        batch.push({
          id: qid(doc._id.toString()),
          vector,
          payload: {
            type: "journal",
            title: safe(doc.title),
            publisher: safe(doc.publisher),
            quartile: safe(doc.sjr_best_quartile),
            sjr: safe(doc.sjr),
            categories: safe(doc.categories),
            areas: safe(doc.areas),
            url: safe(doc.scimago_link),
            text,
            hash: buildHash(doc, "journal"),
          },
        });

        if (batch.length >= BATCH_SIZE) {
          await flushBatch(batch, stats);
        }

        stats.processed++;

        if (stats.processed % 100 === 0) {
          console.log(`⚡ processed=${stats.processed} updated=${stats.updated}`);
        }

      } catch (err) {
        stats.errors++;
        errorLog.write(`[JOURNAL] ${doc._id} ${err.message}\n`);
      }
    });
  }

  await queue.onIdle();

  await flushBatch(batch, stats);

  console.log("🎯 DONE", stats);

  await mongo.close();
  errorLog.end();
}

main();