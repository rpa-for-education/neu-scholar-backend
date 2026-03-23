import { MongoClient } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import axios from "axios";
import { v5 as uuidv5 } from "uuid";
import "dotenv/config";

// ================= TRY LOAD PQUEUE =================
let PQueue = null;

try {
  const mod = await import("p-queue");
  PQueue = mod.default;
  console.log("🚀 Using p-queue (parallel mode)");
} catch {
  console.log("⚠️ p-queue not installed → running sequentially");
}

// ================= CONFIG =================
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "fitneu";

const COLLECTION = "neu-scholar";
const QDRANT_URL = process.env.QDRANT_URL;

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const MODEL = "qwen3-embedding:8b";

const UUID_NAMESPACE = uuidv5.URL;

const BATCH_SIZE = 64;
const CONCURRENCY = 8;
const RETRY = 2;

// ================= INIT =================
const mongo = new MongoClient(MONGODB_URI);

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  checkCompatibility: false,
});

const queue = PQueue
  ? new PQueue({ concurrency: CONCURRENCY })
  : null;

// ================= STATS =================
const stats = {
  processed: 0,
  updated: 0,
  startTime: Date.now(),
};

// ================= UTILS =================
function safe(val) {
  if (!val) return "";
  if (Array.isArray(val)) return val.join(" ");
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function qid(key) {
  return uuidv5(String(key), UUID_NAMESPACE);
}

function logProgress() {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const speed = (stats.processed / elapsed).toFixed(1);

  console.log(
    `⚡ processed=${stats.processed} | updated=${stats.updated} | ${speed}/s`
  );
}

// ================= EMBED =================
async function embed(text, retry = RETRY) {
  try {
    const res = await axios.post(`${OLLAMA_BASE}/api/embed`, {
      model: MODEL,
      input: text,
    });

    return res.data?.embeddings?.[0] || null;

  } catch (err) {
    if (retry > 0) return embed(text, retry - 1);

    console.error("❌ Embed error:", err.message);
    return null;
  }
}

// ================= UPSERT =================
async function flush(batch) {
  if (!batch.length) return;

  const sending = batch.splice(0);

  try {
    await qdrant.upsert(COLLECTION, { points: sending });
    stats.updated += sending.length;
  } catch (err) {
    console.error("❌ Qdrant error:", err.message);
  }
}

// ================= PROCESS =================
async function processDoc(doc, type, batch) {
  const text =
    type === "conference"
      ? [doc.name, doc.topics, doc.city, doc.country].join(" ")
      : [doc.title, doc.categories, doc.publisher].join(" ");

  const vector = await embed(text);
  if (!vector) return;

  let payload;

  if (type === "conference") {
    payload = {
      type,
      name: safe(doc.name),
      deadline: safe(doc.deadline),
      city: safe(doc.city),
      country: safe(doc.country),
      url: safe(doc.url),
      text,
    };
  } else {
    let link = safe(doc.scimago_link);

    if (!link && doc.title) {
      link = `https://www.scimagojr.com/journalsearch.php?q=${encodeURIComponent(doc.title)}`;
    }

    payload = {
      type,
      title: safe(doc.title),
      publisher: safe(doc.publisher),
      sjr_best_quartile: safe(doc.sjr_best_quartile),
      scimago_link: link,
      url: link,
      text,
    };
  }

  batch.push({
    id: qid(doc._id.toString()),
    vector,
    payload,
  });

  stats.processed++;

  if (stats.processed % 50 === 0) logProgress();

  if (batch.length >= BATCH_SIZE) {
    await flush(batch);
  }
}

// ================= MAIN =================
async function main() {
  await mongo.connect();
  const db = mongo.db(DB_NAME);

  console.log("🚀 SYNC SCHOLAR");

  const confs = await db.collection("conference").find({}).toArray();
  const journals = await db.collection("journal").find({}).toArray();

  const batch = [];

  const testVec = await embed("test");

  await qdrant.createCollection(COLLECTION, {
    vectors: { size: testVec.length, distance: "Cosine" },
  }).catch(() => console.log("✅ Collection exists"));

  // ================= RUN =================
  const run = async (fn) => {
    if (queue) {
      queue.add(fn);
    } else {
      await fn();
    }
  };

  for (const doc of confs) {
    await run(() => processDoc(doc, "conference", batch));
  }

  for (const doc of journals) {
    await run(() => processDoc(doc, "journal", batch));
  }

  if (queue) await queue.onIdle();

  await flush(batch);

  logProgress();

  console.log("🎯 DONE");

  await mongo.close();
}

main();