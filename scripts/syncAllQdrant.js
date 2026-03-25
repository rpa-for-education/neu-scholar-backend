import { MongoClient } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import axios from "axios";
import { v5 as uuidv5 } from "uuid";
import "dotenv/config";

// ================= CONFIG =================
const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "fitneu";

const QDRANT_URL = process.env.QDRANT_URL;
const MODEL = "qwen3-embedding:8b";
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;

const UUID_NAMESPACE = uuidv5.URL;

// 🔥 FIX QUAN TRỌNG
const BATCH_SIZE = 20;        // giảm tải
const RETRY = 3;              // retry upsert
const DELAY = 50;             // delay mỗi request

// ================= INIT =================
const mongo = new MongoClient(MONGO_URI);

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  timeout: 60000, // tránh timeout
});

// ================= UTILS =================
const qid = (id) => uuidv5(String(id), UUID_NAMESPACE);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const safe = (v) => {
  if (!v) return "";
  if (Array.isArray(v)) return v.join(" ");
  return String(v);
};

// ================= EMBED =================
async function embed(text, retry = 2) {
  try {
    const res = await axios.post(`${OLLAMA_BASE}/api/embed`, {
      model: MODEL,
      input: text,
    });

    return res.data?.embeddings?.[0];

  } catch (err) {
    if (retry > 0) {
      await sleep(500);
      return embed(text, retry - 1);
    }
    console.warn("⚠️ embed fail:", err.message);
    return null;
  }
}

// ================= SAFE UPSERT =================
async function safeUpsert(col, points, retry = RETRY) {
  try {
    await qdrant.upsert(col, { points });
  } catch (err) {
    if (retry > 0) {
      console.warn(`⚠️ retry upsert ${col}...`);
      await sleep(1000);
      return safeUpsert(col, points, retry - 1);
    }
    console.error(`❌ upsert failed (${col}):`, err.message);
  }
}

// ================= COLLECTION =================
async function ensureCollection(name, size) {
  try {
    await qdrant.getCollection(name);
    console.log(`✅ ${name} exists`);
  } catch {
    await qdrant.createCollection(name, {
      vectors: { size, distance: "Cosine" },
    });
    console.log(`🚀 Created ${name}`);
  }
}

// ================= BUILD TEXT =================

function buildFundText(doc) {
  return [
    doc["OPPORTUNITY TITLE"],
    doc["AGENCY NAME"],
    doc["FUNDING DESCRIPTION"],
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildConferenceText(doc) {
  return [
    doc.name,
    doc.acronym,
    doc.location,
    doc.city,
    doc.country,
    ...(doc.topics || []),
    doc.cfp_text
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildJournalText(doc) {
  return [
    doc.title,
    doc.categories,
    doc.areas,
    doc.publisher,
  ].filter(Boolean).join(" ").toLowerCase();
}

// ================= PAYLOAD =================

function fundPayload(doc) {
  return {
    type: "fund",
    title: doc["OPPORTUNITY TITLE"],
    agency: doc["AGENCY NAME"],
    deadline: doc["ESTIMATED APPLICATION DUE DATE"],
    amount: doc["ESTIMATED TOTAL FUNDING"],
    url: doc["OPPORTUNITY URL"],
    text: buildFundText(doc),
  };
}

function conferencePayload(doc) {
  return {
    type: "conference",
    title: doc.name,
    acronym: doc.acronym,
    city: doc.city,
    country: doc.country,
    country_code: doc.country_code,
    start_date: doc.start_date,
    deadline: doc.deadline,
    url: doc.url,
    text: buildConferenceText(doc),
  };
}

function journalPayload(doc) {
  return {
    type: "journal",
    title: doc.title,
    publisher: doc.publisher,
    country: doc.country,
    sjr: doc.sjr,
    sjr_best_quartile: doc.sjr_best_quartile,
    h_index: doc.h_index,
    url: doc.scimago_link,
    text: buildJournalText(doc),
  };
}

// ================= SYNC =================
async function sync({ mongoCol, qdrantCol, buildText, buildPayload }) {
  console.log(`\n🚀 Sync ${mongoCol} → ${qdrantCol}`);

  const db = mongo.db(DB_NAME);

  const total = await db.collection(mongoCol).countDocuments();
  console.log(`📊 ${mongoCol} total:`, total);

  if (!total) {
    console.warn(`⚠️ ${mongoCol} EMPTY → skip`);
    return;
  }

  const cursor = db.collection(mongoCol).find({});

  const testVec = await embed("test");
  if (!testVec) throw new Error("❌ Cannot embed");

  await ensureCollection(qdrantCol, testVec.length);

  let batch = [];
  let count = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();

    const text = buildText(doc);
    if (!text) continue;

    const vector = await embed(text);
    if (!vector) continue;

    batch.push({
      id: qid(doc._id),
      vector,
      payload: buildPayload(doc),
    });

    if (batch.length >= BATCH_SIZE) {
      await safeUpsert(qdrantCol, batch);
      batch = [];
      await sleep(DELAY); // 🔥 chống overload
    }

    count++;

    if (count % 100 === 0) {
      console.log(`⚡ ${mongoCol}: ${count}/${total}`);
    }
  }

  if (batch.length) {
    await safeUpsert(qdrantCol, batch);
  }

  console.log(`✅ DONE ${mongoCol}: ${count}`);
}

// ================= MAIN =================
async function main() {
  try {
    await mongo.connect();
    console.log("✅ Mongo connected");

    await sync({
      mongoCol: "fund",
      qdrantCol: "fund_vectors",
      buildText: buildFundText,
      buildPayload: fundPayload,
    });

    await sync({
      mongoCol: "conference",
      qdrantCol: "conference_vectors",
      buildText: buildConferenceText,
      buildPayload: conferencePayload,
    });

    await sync({
      mongoCol: "journal",
      qdrantCol: "journal_vectors",
      buildText: buildJournalText,
      buildPayload: journalPayload,
    });

    console.log("\n🎯 ALL DONE");

  } catch (err) {
    console.error("❌ SYNC FATAL:", err);
  } finally {
    await mongo.close();
  }
}

main();