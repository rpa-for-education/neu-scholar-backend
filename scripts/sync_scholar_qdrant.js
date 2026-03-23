import { MongoClient } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import axios from "axios";
import { v5 as uuidv5 } from "uuid";
import PQueue from "p-queue";
import "dotenv/config";

// ================= CONFIG =================
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "fitneu";

const COLLECTION = "neu-scholar";
const QDRANT_URL = process.env.QDRANT_URL;

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const MODEL = "qwen3-embedding:8b";

const UUID_NAMESPACE = uuidv5.URL;

const BATCH_SIZE = 64;
const CONCURRENCY = 8; // 🔥 speed control
const RETRY = 2;

// ================= INIT =================
const mongo = new MongoClient(MONGODB_URI);

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  checkCompatibility: false,
});

const queue = new PQueue({ concurrency: CONCURRENCY });

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

function normalizeDeadline(doc) {
  const d =
    doc.deadline ||
    doc.submission_deadline ||
    doc.cfp_deadline ||
    "";

  if (/^[A-Z]{2,3}$/.test(d)) return "";
  return safe(d);
}

// ================= TEXT =================
function buildConferenceText(doc) {
  return [
    doc.name,
    doc.acronym,
    doc.topics,
    doc.city,
    doc.country,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildJournalText(doc) {
  return [
    doc.title,
    doc.categories,
    doc.areas,
    doc.publisher,
    doc.sjr_best_quartile,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
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

// ================= PROGRESS =================
function logProgress() {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const speed = (stats.processed / elapsed).toFixed(1);

  console.log(
    `⚡ processed=${stats.processed} | updated=${stats.updated} | ${speed}/s`
  );
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

// ================= MAIN =================
async function main() {
  await mongo.connect();
  const db = mongo.db(DB_NAME);

  console.log("🚀 SYNC SCHOLAR (MAX SPEED)");

  const confCursor = db.collection("conference").find({});
  const journalCursor = db.collection("journal").find({});

  const batch = [];

  // detect vector size
  const testVec = await embed("test");
  const VECTOR_SIZE = testVec.length;

  await qdrant.createCollection(COLLECTION, {
    vectors: { size: VECTOR_SIZE, distance: "Cosine" },
  }).catch(() => console.log("✅ Collection exists"));

  // ================= CONFERENCE =================
  while (await confCursor.hasNext()) {
    const doc = await confCursor.next();

    queue.add(async () => {
      const text = buildConferenceText(doc);
      const vector = await embed(text);
      if (!vector) return;

      batch.push({
        id: qid(doc._id.toString()),
        vector,
        payload: {
          type: "conference",
          name: safe(doc.name),
          deadline: normalizeDeadline(doc),
          city: safe(doc.city),
          country: safe(doc.country),
          topics: safe(doc.topics),
          url: safe(doc.url),
          text,
        },
      });

      stats.processed++;

      if (stats.processed % 50 === 0) logProgress();

      if (batch.length >= BATCH_SIZE) {
        await flush(batch);
      }
    });
  }

  // ================= JOURNAL =================
  while (await journalCursor.hasNext()) {
    const doc = await journalCursor.next();

    queue.add(async () => {
      const text = buildJournalText(doc);
      const vector = await embed(text);
      if (!vector) return;

      let link = safe(doc.scimago_link);
      if (!link && doc.title) {
        link = `https://www.scimagojr.com/journalsearch.php?q=${encodeURIComponent(doc.title)}`;
      }

      batch.push({
        id: qid(doc._id.toString()),
        vector,
        payload: {
          type: "journal",
          title: safe(doc.title),
          publisher: safe(doc.publisher),
          sjr_best_quartile: safe(doc.sjr_best_quartile),
          categories: safe(doc.categories),
          areas: safe(doc.areas),
          scimago_link: link,
          url: link,
          text,
        },
      });

      stats.processed++;

      if (stats.processed % 50 === 0) logProgress();

      if (batch.length >= BATCH_SIZE) {
        await flush(batch);
      }
    });
  }

  await queue.onIdle();
  await flush(batch);

  logProgress();

  console.log("🎯 SYNC DONE");

  await mongo.close();
}

main();