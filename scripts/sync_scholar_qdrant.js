import { MongoClient } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import axios from "axios";
import { v5 as uuidv5 } from "uuid";
import PQueue from "p-queue";
import "dotenv/config";

// ================= CONFIG =================
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "fitneu";

const COLLECTION = "scholar_vectors";
const QDRANT_URL = process.env.QDRANT_URL;

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const MODEL = process.env.OLLAMA_EMBEDDING_MODEL;

const UUID_NAMESPACE = uuidv5.URL;

const BATCH_SIZE = 64;
const CONCURRENCY = 5;
const RETRY = 2;

// ================= INIT =================
const mongo = new MongoClient(MONGODB_URI);

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  checkCompatibility: false,
});

const queue = new PQueue({ concurrency: CONCURRENCY });

// ================= UTILS =================
function qid(key) {
  return uuidv5(String(key), UUID_NAMESPACE);
}

function buildHash(doc, type) {
  if (type === "conference") {
    return JSON.stringify({
      name: doc.name,
      deadline: doc.deadline,
    });
  }

  return JSON.stringify({
    title: doc.title,
    quartile: doc.sjr_best_quartile,
    sjr: doc.sjr,
  });
}

// ================= BUILD TEXT =================
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
    .toLowerCase()
    .trim();
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

    console.error("❌ Embed failed");
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

  console.log("🚀 SYNC SCHOLAR (conference + journal)");

  const conferenceCursor = db.collection("conference").find({});
  const journalCursor = db.collection("journal").find({});

  const batch = [];

  let processed = 0;
  let updated = 0;

  // 👉 detect vector size
  const testVec = await embed("test scholar");
  const VECTOR_SIZE = testVec.length;

  console.log("📐 VECTOR SIZE:", VECTOR_SIZE);

  await ensureCollection(VECTOR_SIZE);

  // ================= PROCESS CONFERENCE =================
  while (await conferenceCursor.hasNext()) {
    const doc = await conferenceCursor.next();

    await queue.add(async () => {
      try {
        const id = qid(doc._id);
        const text = buildConferenceText(doc);

        if (!text) {
          processed++;
          return;
        }

        const vector = await embed(text);
        if (!vector) {
          processed++;
          return;
        }

        batch.push({
          id,
          vector,
          payload: {
            type: "conference",

            name: doc.name,
            title: doc.name,
            acronym: doc.acronym,

            year: doc.start_date?.slice(0, 4),
            deadline: doc.deadline,

            city: doc.city,
            country: doc.country,
            continent: doc.continent,

            topics: doc.topics,
            url: doc.url,

            text,
            hash: buildHash(doc, "conference"),
          },
        });

        if (batch.length >= BATCH_SIZE) {
          await qdrant.upsert(COLLECTION, {
            points: batch.splice(0),
          });
          updated += BATCH_SIZE;
        }

        processed++;

        if (processed % 100 === 0) {
          console.log(`⚡ processed=${processed} updated=${updated}`);
        }

      } catch (err) {
        console.error("❌ Conference error:", doc._id);
        processed++;
      }
    });
  }

  // ================= PROCESS JOURNAL =================
  while (await journalCursor.hasNext()) {
    const doc = await journalCursor.next();

    await queue.add(async () => {
      try {
        const id = qid(doc._id);
        const text = buildJournalText(doc);

        if (!text) {
          processed++;
          return;
        }

        const vector = await embed(text);
        if (!vector) {
          processed++;
          return;
        }

        batch.push({
          id,
          vector,
          payload: {
            type: "journal",

            title: doc.title,
            publisher: doc.publisher,

            quartile: doc.sjr_best_quartile,
            sjr: doc.sjr,
            h_index: doc.h_index,

            country: doc.country,
            region: doc.region,

            categories: doc.categories,
            areas: doc.areas,

            url: doc.scimago_link,

            text,
            hash: buildHash(doc, "journal"),
          },
        });

        if (batch.length >= BATCH_SIZE) {
          await qdrant.upsert(COLLECTION, {
            points: batch.splice(0),
          });
          updated += BATCH_SIZE;
        }

        processed++;

        if (processed % 100 === 0) {
          console.log(`⚡ processed=${processed} updated=${updated}`);
        }

      } catch (err) {
        console.error("❌ Journal error:", doc._id);
        processed++;
      }
    });
  }

  await queue.onIdle();

  // flush cuối
  if (batch.length) {
    await qdrant.upsert(COLLECTION, { points: batch });
    updated += batch.length;
  }

  console.log("🎯 DONE", {
    processed,
    updated,
  });

  await mongo.close();
}

main();