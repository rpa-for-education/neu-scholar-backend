// import.js (fixed & optimized)
import fs from "fs";
import { MongoClient } from "mongodb";
import { pipeline } from "@xenova/transformers";
import pLimit from "p-limit";
import "dotenv/config";

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "rpa";

// ===== MongoDB Singleton =====
let _client;
let _db;
async function getDb() {
  if (!_db) {
    _client = new MongoClient(MONGODB_URI);
    await _client.connect();
    _db = _client.db(MONGODB_DB);
    console.log(`✅ MongoDB connected (import.js) → DB: ${MONGODB_DB}`);
  }
  return _db;
}

// ===== Embedding Model Singleton =====
let _embedderPromise;
async function getEmbedder() {
  if (!_embedderPromise) {
    console.log("⏳ Loading embedding model: Xenova/all-MiniLM-L6-v2");
    _embedderPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    console.log("✅ Embedding model ready");
  }
  return _embedderPromise;
}

function flattenEmbedding(result) {
  if (!result) return [];
  if (result.data) return Array.from(result.data);
  if (Array.isArray(result[0]?.data)) return Array.from(result[0].data);
  if (Array.isArray(result[0])) return result[0].flat();
  if (Array.isArray(result)) return result;
  return [];
}

// ===== Batch Embedding (safe for 1 or many inputs) =====
async function embedBatch(texts) {
  const embedder = await getEmbedder();
  const outputs = await embedder(texts, { pooling: "mean", normalize: true });
  const arr = Array.isArray(outputs) ? outputs : [outputs];
  return arr.map(flattenEmbedding);
}

// ===== Helper: Import collection =====
async function importCollection(db, name, records, fields) {
  if (!records?.length) {
    console.warn(`⚠️ No data for collection "${name}"`);
    return;
  }

  console.log(`📦 Importing ${records.length} docs into "${name}"...`);

  const contents = records.map(item =>
    fields
      .map(f => {
        const val = item[f];
        return Array.isArray(val) ? val.join(" ") : val || "";
      })
      .filter(Boolean)
      .join(" ")
  );

  const BATCH_SIZE = 32;
  let vectors = [];
  for (let i = 0; i < contents.length; i += BATCH_SIZE) {
    const batch = contents.slice(i, i + BATCH_SIZE);
    const vecs = await embedBatch(batch);
    vectors.push(...vecs);
    console.log(`   → Embedded ${Math.min(i + BATCH_SIZE, contents.length)}/${contents.length}`);
  }

  const limit = pLimit(10);
  await Promise.all(records.map((item, idx) =>
    limit(() =>
      db.collection(name).updateOne(
        { [fields[0]]: item[fields[0]] },
        { $set: { ...item, vector: vectors[idx] } },
        { upsert: true }
      )
    )
  ));

  console.log(`✅ Imported ${records.length} docs into "${name}"`);
}

// ===== Main import =====
export async function runImport() {
  const db = await getDb();
  const data = JSON.parse(fs.readFileSync("./data.json", "utf-8"));

  await importCollection(db, "journal", data.journal, ["title", "publisher", "categories", "areas"]);
  await importCollection(db, "conference", data.conference, ["name", "acronym", "location", "topics"]);

  console.log("🎯 Import finished.");
}

// Run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runImport().then(() => {
    console.log("🔌 MongoDB connection closed");
    _client?.close();
  });
}
