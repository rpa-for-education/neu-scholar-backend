import { MongoClient } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import axios from "axios";
import { v5 as uuidv5 } from "uuid";
import fs from "fs";
import "dotenv/config";

// ================= CONFIG =================
const MONGODB_URI = process.env.MONGODB_URI || "";
const DB_NAME = process.env.MONGODB_DB || "fitneu";

const COLLECTION = "neu-scholar";
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const MODEL = "qwen3-embedding:8b";

const UUID_NAMESPACE = uuidv5.URL;
const BATCH_SIZE = 64;
const RETRY = 2;

// ================= INIT =================
const mongo = new MongoClient(MONGODB_URI);

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  checkCompatibility: false,
});

// ================= LOG =================
const errorLog = fs.createWriteStream("sync_errors.log", { flags: "a" });

// ================= SAFE =================
function safe(val) {
  if (!val) return "";
  if (Array.isArray(val)) return val.join(" ");
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function qid(key) {
  return uuidv5(String(key), UUID_NAMESPACE);
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

// ================= COLLECTION =================
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
  }
}

// ================= CLEAN DEADLINE =================
function normalizeDeadline(doc) {
  const d =
    doc.deadline ||
    doc.submission_deadline ||
    doc.cfp_deadline ||
    "";

  // loại bỏ CA, NY, TX...
  if (/^[A-Z]{2,3}$/.test(d)) return "";

  return safe(d);
}

// ================= MAIN =================
async function main() {
  await mongo.connect();
  const db = mongo.db(DB_NAME);

  console.log("🚀 SYNC SCHOLAR (FINAL FIX)");

  const confCursor = db.collection("conference").find({});
  const journalCursor = db.collection("journal").find({});

  const batch = [];

  const testVec = await embed("test");
  const VECTOR_SIZE = testVec.length;

  await ensureCollection(VECTOR_SIZE);

  // ================= CONFERENCE =================
  while (await confCursor.hasNext()) {
    const doc = await confCursor.next();

    try {
      const text = buildConferenceText(doc);
      const vector = await embed(text);
      if (!vector) continue;

      batch.push({
        id: qid(doc._id.toString()),
        vector,
        payload: {
          type: "conference",
          name: safe(doc.name),
          acronym: safe(doc.acronym),

          // 🔥 FIX DEADLINE
          deadline: normalizeDeadline(doc),

          city: safe(doc.city),
          state: safe(doc.state),
          country: safe(doc.country),
          topics: safe(doc.topics),

          // 🔥 FIX LINK
          url: safe(doc.url),

          text,
        },
      });

      if (batch.length >= BATCH_SIZE) {
        await qdrant.upsert(COLLECTION, { points: batch.splice(0) });
      }

    } catch (err) {
      errorLog.write(`[CONF] ${doc._id} ${err.message}\n`);
    }
  }

  // ================= JOURNAL =================
  while (await journalCursor.hasNext()) {
    const doc = await journalCursor.next();

    try {
      const text = buildJournalText(doc);
      const vector = await embed(text);
      if (!vector) continue;

      // 🔥 FIX LINK (QUAN TRỌNG NHẤT)
      let scimagoLink = safe(doc.scimago_link);

      // fallback nếu DB thiếu link
      if (!scimagoLink && doc.title) {
        scimagoLink =
          "https://www.scimagojr.com/journalsearch.php?q=" +
          encodeURIComponent(doc.title);
      }

      batch.push({
        id: qid(doc._id.toString()),
        vector,
        payload: {
          type: "journal",
          title: safe(doc.title),
          publisher: safe(doc.publisher),

          // 🔥 FIX QUARTILE
          sjr_best_quartile: safe(doc.sjr_best_quartile),

          sjr: safe(doc.sjr),
          categories: safe(doc.categories),
          areas: safe(doc.areas),

          // 🔥 FIX LINK
          scimago_link: scimagoLink,
          url: scimagoLink,

          text,
        },
      });

      if (batch.length >= BATCH_SIZE) {
        await qdrant.upsert(COLLECTION, { points: batch.splice(0) });
      }

    } catch (err) {
      errorLog.write(`[JOURNAL] ${doc._id} ${err.message}\n`);
    }
  }

  // flush
  if (batch.length) {
    await qdrant.upsert(COLLECTION, { points: batch });
  }

  console.log("🎯 SYNC DONE (FIXED)");

  await mongo.close();
  errorLog.end();
}

main();