import { MongoClient } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import axios from "axios";
import { v5 as uuidv5 } from "uuid";
import "dotenv/config";

// ================= CONFIG =================
const MONGO_URI = process.env.MONGODB_URI;

const DB_NAME =
  process.env.MONGODB_DB ||
  process.env.DB_NAME ||
  "fitneu";

const QDRANT_URL = process.env.QDRANT_URL;
const MODEL = "qwen3-embedding:8b";
const OLLAMA = process.env.OLLAMA_BASE_URL;

const UUID_NAMESPACE = uuidv5.URL;

const EMBED_BATCH = 16;
const UPSERT_BATCH = 64;

// ================= INIT =================
const mongo = new MongoClient(MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
});

const qdrant = new QdrantClient({ url: QDRANT_URL });

// ================= UTILS =================
const qid = (id) => uuidv5(String(id), UUID_NAMESPACE);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const norm = (t) =>
  String(t || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ================= EMBED =================
async function embedBatch(texts, retry = 2) {
  try {
    const res = await axios.post(`${OLLAMA}/api/embed`, {
      model: MODEL,
      input: texts,
    });

    return res.data?.embeddings || [];
  } catch (err) {
    if (retry > 0) {
      await sleep(300);
      return embedBatch(texts, retry - 1);
    }

    return texts.map(() => null);
  }
}

// ================= COLLECTION =================
async function ensureCollection(name, size) {
  try {
    await qdrant.getCollection(name);
  } catch {
    await qdrant.createCollection(name, {
      vectors: { size, distance: "Cosine" },
    });
    console.log("🚀 Created:", name);
  }
}

// ================= BUILD TEXT =================
const buildText = {
  journal: (doc) =>
    norm([
      "journal",
      doc.title,
      doc.publisher,
      doc.country,
      doc.sjr,
      doc.sjr_best_quartile,
    ].join(" ")),

  fund: (doc) =>
    norm([
      "fund",
      doc.opportunity_title,
      doc.agency_name,
      doc.description,
      doc.category,
    ].join(" ")),

  conference: (doc) =>
    norm([
      "conference",
      doc.name,
      doc.acronym,
      doc.location,
      doc.country,
      doc.cfp_text,
    ].join(" ")),
};

// ================= PAYLOAD =================
const payloadMap = {
  journal: (doc) => ({
    type: "journal",
    title: doc.title,
    publisher: doc.publisher,
    country: doc.country,
    quartile: doc.sjr_best_quartile,
  }),

  fund: (doc) => ({
    type: "fund",
    title: doc.opportunity_title,
    agency: doc.agency_name,
    amount: doc.funding_amount,
    country: doc.country,
  }),

  conference: (doc) => ({
    type: "conference",
    title: doc.name,
    acronym: doc.acronym,
    country: doc.country,
  }),
};

// ================= CORE =================
async function sync(type, mongoCol, qdrantCol) {
  console.log(`\n🚀 Sync ${type}`);

  const col = mongo.db(DB_NAME).collection(mongoCol);

  const total = await col.countDocuments();
  console.log("📊 total:", total);

  const testVec = (await embedBatch(["test"]))[0];
  await ensureCollection(qdrantCol, testVec.length);

  const cursor = col.find({});
  let batch = [];

  while (await cursor.hasNext()) {
    batch.push(await cursor.next());

    if (batch.length >= EMBED_BATCH) {
      await processBatch(batch);
      batch = [];
    }
  }

  if (batch.length) await processBatch(batch);

  console.log(`✅ DONE ${type}`);

  async function processBatch(docs) {
    const texts = docs.map(buildText[type]);
    const vectors = await embedBatch(texts);

    const points = docs.map((doc, i) => ({
      id: qid(doc._id),
      vector: vectors[i] || new Array(testVec.length).fill(0),
      payload: payloadMap[type](doc),
    }));

    for (let i = 0; i < points.length; i += UPSERT_BATCH) {
      await qdrant.upsert(qdrantCol, {
        points: points.slice(i, i + UPSERT_BATCH),
      });
    }
  }
}

// ================= MAIN =================
async function main() {
  await mongo.connect();
  console.log("✅ Mongo connected");

  await sync("fund", "fund", "fund_vectors");
  await sync("journal", "journal", "journal_vectors");
  await sync("conference", "conference", "conference_vectors");

  console.log("🎯 ALL DONE");
  process.exit(0);
}

main();