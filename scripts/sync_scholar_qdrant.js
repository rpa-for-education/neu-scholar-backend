import { MongoClient } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import axios from "axios";
import { v5 as uuidv5 } from "uuid";
import cliProgress from "cli-progress";
import "dotenv/config";

// ================= CONFIG =================
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "fitneu";

const COLLECTION_NAME = "scholar";
const QDRANT_COLLECTION = "scholar_vectors";

const QDRANT_URL = process.env.QDRANT_URL;

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const EMBED_MODEL = process.env.OLLAMA_EMBEDDING_MODEL;

const VECTOR_SIZE = 4096;
const UUID_NAMESPACE = uuidv5.URL;

const RETRY = 3;

// ================= INIT =================
const mongo = new MongoClient(MONGODB_URI);

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  checkCompatibility: false,
});

// ================= UTILS =================
function qid(key) {
  return uuidv5(String(key), UUID_NAMESPACE);
}

function buildHash(doc) {
  return JSON.stringify({
    title: doc.title,
    abstract: doc.abstract,
    year: doc.year,
  });
}

function buildText(doc) {
  return [
    doc.title,
    doc.abstract,
    doc.authors,
    doc.venue,
    doc.keywords,
  ]
    .filter(Boolean)
    .join(" ");
}

// ================= EMBEDDING =================
async function embed(text, retry = RETRY) {
  try {
    const res = await axios.post(`${OLLAMA_BASE}/api/embed`, {
      model: EMBED_MODEL,
      input: text,
    });

    const vec = res.data?.embeddings?.[0] || res.data?.embedding;

    if (!vec || vec.length !== VECTOR_SIZE) {
      throw new Error(`Invalid vector: ${vec?.length}`);
    }

    return vec;
  } catch (err) {
    if (retry > 0) {
      return embed(text, retry - 1);
    }
    console.error("❌ Embedding failed");
    return null;
  }
}

// ================= MAIN =================
async function main() {
  await mongo.connect();
  const db = mongo.db(DB_NAME);

  console.log("🚀 Sync SCHOLAR (with progress)...");

  const docs = await db.collection(COLLECTION_NAME).find({}).toArray();
  const TOTAL = docs.length;

  let updated = 0;
  let skipped = 0;
  let processed = 0;

  const start = Date.now();

  const bar = new cliProgress.SingleBar({
    format:
      "📊 {bar} {percentage}% | {value}/{total} | ⚡ {speed} | ETA {eta}s",
  });

  bar.start(TOTAL, 0, { speed: "0 docs/s", eta: 0 });

  for (const doc of docs) {
    try {
      const id = qid(doc._id);
      const hash = buildHash(doc);

      const existing = await qdrant.retrieve(QDRANT_COLLECTION, {
        ids: [id],
        with_payload: true,
      });

      if (existing.length > 0) {
        const oldHash = existing[0].payload?.hash;
        if (oldHash === hash) {
          skipped++;
          processed++;
          updateBar();
          continue;
        }
      }

      const text = buildText(doc);
      if (!text) {
        processed++;
        updateBar();
        continue;
      }

      const vector = await embed(text);
      if (!vector) {
        processed++;
        updateBar();
        continue;
      }

      await qdrant.upsert(QDRANT_COLLECTION, {
        points: [
          {
            id,
            vector,
            payload: {
              type: "scholar",
              title: doc.title,
              abstract: doc.abstract,
              authors: doc.authors,
              venue: doc.venue,
              year: doc.year,
              citations: doc.citations,
              url: doc.url,
              keywords: doc.keywords,
              text,
              hash,
            },
          },
        ],
      });

      updated++;
      processed++;
      updateBar();

    } catch (err) {
      processed++;
      updateBar();
    }
  }

  bar.stop();

  console.log(`🎯 DONE → updated=${updated} | skipped=${skipped}`);

  await mongo.close();
}

// ================= PROGRESS =================
function updateBar() {
  const elapsed = (Date.now() - start) / 1000;
  const speed = (processed / elapsed).toFixed(2);
  const eta = ((TOTAL - processed) / speed).toFixed(0);

  bar.update(processed, {
    speed: `${speed} docs/s`,
    eta,
  });
}

main();