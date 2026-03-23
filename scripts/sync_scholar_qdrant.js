import axios from "axios";
import { MongoClient } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import cliProgress from "cli-progress";
import { v5 as uuidv5 } from "uuid";
import "dotenv/config";

// ================= CONFIG =================
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "fitneu";

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

// 🔥 FIX: dùng đúng collection đang query
const COLLECTION = "scholar_vectors";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const EMBED_MODEL =
  process.env.OLLAMA_EMBEDDING_MODEL || "qwen3-embedding:8b";

const VECTOR_SIZE = 4096;
const UUID_NAMESPACE = uuidv5.URL;
const BATCH_SIZE = 8;

// ================= INIT =================
const mongo = new MongoClient(MONGODB_URI);

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY,
  checkCompatibility: false,
});

// ================= UTILS =================
function qid(key) {
  return uuidv5(String(key), UUID_NAMESPACE);
}

function clean(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(
      ([_, v]) => v !== null && v !== undefined && v !== ""
    )
  );
}

// ================= COLLECTION =================
async function ensureCollection() {
  try {
    const info = await qdrant.getCollection(COLLECTION);
    const size = info.config.params.vectors.size;

    if (size !== VECTOR_SIZE) {
      console.log("⚠️ Wrong dimension → recreate");

      await qdrant.deleteCollection(COLLECTION);

      await qdrant.createCollection(COLLECTION, {
        vectors: { size: VECTOR_SIZE, distance: "Cosine" },
      });
    } else {
      console.log("✅ Collection OK");
    }
  } catch {
    console.log("🚀 Creating collection...");

    await qdrant.createCollection(COLLECTION, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });

    console.log("✅ Collection created");
  }
}

// ================= EMBED =================
async function embed(text, retry = 2) {
  try {
    const res = await axios.post(
      `${OLLAMA_BASE}/api/embed`,
      {
        model: EMBED_MODEL,
        input: text,
      },
      { timeout: 60000 }
    );

    const vec = res.data?.embeddings?.[0];

    if (!vec || vec.length !== VECTOR_SIZE) {
      throw new Error(`Invalid vector length: ${vec?.length}`);
    }

    return vec;
  } catch (err) {
    if (retry > 0) {
      console.log("⚠️ Retry embedding...");
      await new Promise((r) => setTimeout(r, 1000));
      return embed(text, retry - 1);
    }

    console.error("❌ Embedding failed:", err.message);
    return null; // 🔥 KHÔNG crash
  }
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
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    item.name,
    item.acronym,
    item.topics,
    item.description,
    item.country,
    item.city,
  ]
    .filter(Boolean)
    .join(" ");
}

// ================= PAYLOAD =================
function buildPayload(item, type, text) {
  if (type === "journal") {
    return clean({
      type: "journal",
      key: item._id || item._key,
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
    key: item._id || item._key,
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

    await new Promise((r) => setTimeout(r, 1500));

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
        if (!vector) continue;

        const payload = buildPayload(item, name, text);

        points.push({
          id: qid(item._id || item._key), // 🔥 FIX
          vector,
          payload,
        });
      } catch (err) {
        console.log("❌ Skip:", item._id || item._key);
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

    await ensureCollection(); // 🔥 luôn sync (không skip)

    await syncCollection(db, "conference");
    await syncCollection(db, "journal");

    console.log("🎯 SYNC DONE");
  } catch (e) {
    console.error("❌ Sync error:", e.message);
  } finally {
    await mongo.close();
    console.log("🔌 Mongo closed");
  }
})();