// syncAllQdrant.js - Sync all data to Qdrant with improved embedding and payload
import { MongoClient } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import axios from "axios";
import { v5 as uuidv5 } from "uuid";
import "dotenv/config";

// ================= CONFIG =================
const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB;

const QDRANT_URL = process.env.QDRANT_URL;
const MODEL = "qwen3-embedding:8b";
const OLLAMA = process.env.OLLAMA_BASE_URL;

const UUID_NAMESPACE = uuidv5.URL;

const EMBED_BATCH = 16;
const UPSERT_BATCH = 64;
const DELAY = 20;

// ================= INIT =================
const mongo = new MongoClient(MONGO_URI);
const qdrant = new QdrantClient({ url: QDRANT_URL });

// ================= UTILS =================
const qid = (id) => uuidv5(String(id), UUID_NAMESPACE);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

//
// ===================== TEXT BUILD =====================
//

// 🔥 JOURNAL (giữ nguyên)
function buildJournalText(doc) {
  return norm([
    "journal",
    doc.title,

    ...(doc.fields || []),
    doc.categories,
    doc.areas,

    doc.publisher,
    doc.country,

    doc.sjr ? `sjr ${doc.sjr}` : "",
    doc.sjr_best_quartile ? `quartile ${doc.sjr_best_quartile}` : "",

    "research journal academic publication"
  ].join(" "));
}

// 🔥 FUND (giữ nguyên logic của bạn)
function buildFundText(doc) {
  return norm([
    "research grant funding",

    doc.opportunity_title,

    doc.agency_code,
    doc.agency_name,

    doc.country,
    "vietnam nafosted grant research funding",

    doc.category,
    doc.funding_categories,

    doc.description,

    doc.applicant_types,
    doc.funding_instruments,

    doc.opportunity_number,
    doc.opportunity_id,

    "grant funding scholarship research support"
  ].join(" "));
}

// 🔥 CONFERENCE (giữ nguyên)
function buildConferenceText(doc) {
  return norm([
    "academic conference call for papers cfp",

    doc.name,
    doc.acronym,

    doc.location,
    doc.city,
    doc.country,

    doc.cfp_text,

    "conference submission research event"
  ].join(" "));
}

//
// ===================== PAYLOAD =====================
//

function journalPayload(doc) {
  return {
    type: "journal",

    title: doc.title,
    publisher: doc.publisher,

    country: doc.country,

    fields: doc.fields || [],

    sjr: doc.sjr,
    quartile: doc.sjr_best_quartile,

    open_access: doc.open_access,
    vn: doc.vn_professor_council,

    url: doc.scimago_link,
  };
}

// 🔥🔥🔥 CHỈ SỬA DUY NHẤT Ở ĐÂY (THÊM text)
function fundPayload(doc) {
  return {
    type: "fund",

    title: doc.opportunity_title,
    agency: doc.agency_name,

    // 🔥 FIX QUAN TRỌNG NHẤT
    text: [
      doc.opportunity_title,
      doc.agency_name,
      doc.agency_code,
      doc.description,
      doc.category,
      doc.funding_categories
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),

    deadline: doc.close_date,
    amount: doc.funding_amount,

    category: doc.category,

    country: doc.country || "Vietnam",

    url: doc.url,
  };
}

function confPayload(doc) {
  return {
    type: "conference",

    title: doc.name,
    acronym: doc.acronym,

    deadline: doc.deadline,

    city: doc.city,
    country: doc.country,

    url: doc.url,
  };
}

//
// ===================== CORE SYNC =====================
//

async function sync({ mongoCol, qdrantCol, buildText, buildPayload }) {
  console.log(`\n🚀 Sync ${mongoCol}`);

  const col = mongo.db(DB_NAME).collection(mongoCol);

  const cursor = col.find({});
  const total = await col.countDocuments();

  console.log("📊 total:", total);

  const testVec = (await embedBatch(["test"]))[0];
  if (!testVec) throw new Error("❌ embedding fail");

  await ensureCollection(qdrantCol, testVec.length);

  let docs = [];
  let count = 0;

  while (await cursor.hasNext()) {
    docs.push(await cursor.next());

    if (docs.length >= EMBED_BATCH) {
      await processBatch(docs);
      docs = [];
    }

    count++;
    if (count % 200 === 0) {
      console.log(`⚡ ${mongoCol}: ${count}/${total}`);
    }
  }

  if (docs.length) await processBatch(docs);

  console.log(`✅ DONE ${mongoCol}`);

  async function processBatch(batchDocs) {
    const texts = batchDocs.map(buildText);
    const vectors = await embedBatch(texts);

    const points = batchDocs.map((doc, i) => ({
      id: qid(doc.u_key || doc._id),
      vector: vectors[i] || new Array(testVec.length).fill(0),
      payload: buildPayload(doc),
    }));

    for (let i = 0; i < points.length; i += UPSERT_BATCH) {
      const slice = points.slice(i, i + UPSERT_BATCH);
      await qdrant.upsert(qdrantCol, { points: slice });
      await sleep(DELAY);
    }
  }
}

//
// ===================== MAIN =====================
//

async function main() {
  await mongo.connect();
  console.log("✅ Mongo connected");

  await sync({
    mongoCol: "journal",
    qdrantCol: "journal_vectors",
    buildText: buildJournalText,
    buildPayload: journalPayload,
  });

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
    buildPayload: confPayload,
  });

  console.log("\n🎯 ALL DONE");
  process.exit(0);
}

main();