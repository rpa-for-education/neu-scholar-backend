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
const BATCH_SIZE = 64;

// ================= INIT =================
const mongo = new MongoClient(MONGO_URI);
const qdrant = new QdrantClient({ url: QDRANT_URL });

// ================= UTILS =================
const qid = (id) => uuidv5(String(id), UUID_NAMESPACE);

const safe = (v) => {
  if (!v) return "";
  if (Array.isArray(v)) return v.join(" ");
  return String(v);
};

// ================= EMBED =================
async function embed(text) {
  const res = await axios.post(`${OLLAMA_BASE}/api/embed`, {
    model: MODEL,
    input: text,
  });
  return res.data?.embeddings?.[0];
}

// ================= CREATE COLLECTION =================
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

// 🔥 FUND
function buildFundText(doc) {
  return [
    doc["OPPORTUNITY TITLE"],
    doc["AGENCY NAME"],
    doc["FUNDING DESCRIPTION"],
  ].join(" ").toLowerCase();
}

// 🔥 CONFERENCE (QUAN TRỌNG)
function buildConferenceText(doc) {
  return [
    doc.name,
    doc.acronym,
    doc.location,
    doc.city,
    doc.country,
    ...(doc.topics || []),
    doc.cfp_text // 🔥 KEY CHÍNH
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// 🔥 JOURNAL
function buildJournalText(doc) {
  return [
    doc.title,
    doc.categories,
    doc.areas,
    doc.publisher,
  ].join(" ").toLowerCase();
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
    text: buildConferenceText(doc), // 🔥 quan trọng
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

// ================= GENERIC SYNC =================
async function sync({ mongoCol, qdrantCol, buildText, buildPayload }) {
  console.log(`\n🚀 Sync ${mongoCol} → ${qdrantCol}`);

  const db = mongo.db(DB_NAME);
  const cursor = db.collection(mongoCol).find({});

  const testVec = await embed("test");
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
      await qdrant.upsert(qdrantCol, { points: batch });
      batch = [];
    }

    count++;
    if (count % 100 === 0) console.log(`⚡ ${mongoCol}: ${count}`);
  }

  if (batch.length) {
    await qdrant.upsert(qdrantCol, { points: batch });
  }

  console.log(`✅ DONE ${mongoCol}: ${count}`);
}

// ================= MAIN =================
async function main() {
  await mongo.connect();

  await sync({
    mongoCol: "fund",
    qdrantCol: "fund_vectors",
    buildText: buildFundText,
    buildPayload: fundPayload,
  });

  await sync({
    mongoCol: "conferences",
    qdrantCol: "conference_vectors",
    buildText: buildConferenceText,
    buildPayload: conferencePayload,
  });

  await sync({
    mongoCol: "journals",
    qdrantCol: "journal_vectors",
    buildText: buildJournalText,
    buildPayload: journalPayload,
  });

  await mongo.close();
  console.log("\n🎯 ALL DONE");
}

main();