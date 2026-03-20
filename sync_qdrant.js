// sync_qdrant.js
import axios from "axios";
import { MongoClient } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import cliProgress from "cli-progress";
import { v5 as uuidv5 } from "uuid";
import "dotenv/config";

// ================= CONFIG =================
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "rpa";

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const COLLECTION = "neu-scholar";

const EMBEDDING_API = "https://research.neu.edu.vn/ollama/api/embed";

const UUID_NAMESPACE = uuidv5.URL;
const BATCH_SIZE = 8;

// ================= INIT =================
const mongo = new MongoClient(MONGODB_URI);

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY,
});

// ================= UTILS =================
function qid(key) {
  return uuidv5(String(key), UUID_NAMESPACE);
}

function clean(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== null && v !== undefined && v !== "")
  );
}

// ================= EMBED =================
async function embed(text) {
  const res = await axios.post(EMBEDDING_API, {
    model: "qwen3-embedding:8b",
    input: text,
  });

  const vec = res.data?.embeddings?.[0];

  // 🔥 FIX: validate dimension
  if (!vec || !Array.isArray(vec) || vec.length !== 4096) {
    throw new Error("Invalid embedding vector");
  }

  return vec;
}

// ================= TEXT =================
function buildText(item, type) {
  if (type === "journal") {
    return [
      item.title,
      item.areas,
      item.categories,
      item.publisher,
      item.country,
    ].filter(Boolean).join(" ");
  }

  return [
    item.name,
    item.acronym,
    item.topics,
    item.description,
    item.country,
    item.city,
  ].filter(Boolean).join(" ");
}

// ================= PAYLOAD =================
function buildPayload(item, type, text) {
  if (type === "journal") {
    return clean({
      type: "journal",
      key: item._key,
      title: item.title,
      text,

      publisher: item.publisher,
      country: item.country,

      areas: item.areas,
      categories: item.categories,

      quartile: item.sjr_best_quartile || null,
      sjr: Number(item.sjr) || 0,
      h_index: Number(item.h_index) || 0,

      source: "neu-research",
    });
  }

  return clean({
    type: "conference",
    key: item._key,
    name: item.name,
    title: item.title || item.name,
    text,

    year: item.start_date ? Number(item.start_date.slice(0, 4)) : null,

    country: item.country,
    city: item.city || item.location,
    continent: item.continent,

    deadline: item.deadline,
    topics: item.topics,
    url: item.url,

    source: "neu-research",
  });
}

// ================= UPSERT =================
async function upsert(points) {
  if (!points.length) return;

  try {
    await qdrant.upsert(COLLECTION, {
      wait: true,
      points,
    });
  } catch (e) {
    console.log("⚠️ Retry Qdrant...", e.message);
    await new Promise(r => setTimeout(r, 1000));

    await qdrant.upsert(COLLECTION, {
      wait: true,
      points,
    });
  }
}

// ================= SYNC =================
async function syncCollection(db, name) {
  console.log(`🚀 Sync ${name}`);

  const docs = await db.collection(name).find({}).toArray();

  const bar = new cliProgress.SingleBar({
    format: `${name} [{bar}] {percentage}% | {value}/{total}`,
  });

  bar.start(docs.length, 0);

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);

    const points = [];

    for (const item of batch) {
      try {
        const text = buildText(item, name);
        if (!text) continue;

        const vector = await embed(text);
        const payload = buildPayload(item, name, text);

        points.push({
          id: qid(item._key),

          // 🔥 FIX QUAN TRỌNG NHẤT
          vector: {
            default: vector
          },

          payload,
        });

      } catch (err) {
        console.log("❌ Skip:", item._key, err.message);
      }
    }

    await upsert(points);

    bar.update(Math.min(i + batch.length, docs.length));
  }

  bar.stop();
  console.log(`✅ Done ${name}`);
}

// ================= MAIN =================
(async () => {
  try {
    await mongo.connect();
    const db = mongo.db(MONGODB_DB);

    console.log("✅ Mongo connected");

    await syncCollection(db, "conference");
    await syncCollection(db, "journal");

    console.log("🎯 SYNC DONE");
  } catch (e) {
    console.error("❌ Sync error:", e.message);
  } finally {
    await mongo.close();
  }
})();