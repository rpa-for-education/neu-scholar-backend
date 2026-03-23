import { MongoClient } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import axios from "axios";
import { v5 as uuidv5 } from "uuid";
import cliProgress from "cli-progress";
import "dotenv/config";

// ================= CONFIG =================
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "fitneu";

const COLLECTION = "fund_vectors";
const QDRANT_URL = process.env.QDRANT_URL;

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const MODEL = process.env.OLLAMA_EMBEDDING_MODEL;

const VECTOR_SIZE = 4096;
const UUID_NAMESPACE = uuidv5.URL;
const RETRY = 3;

// ================= INIT =================
const mongo = new MongoClient(MONGODB_URI);

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  checkCompatibility: false,
});

// ================= GLOBAL =================
let processed = 0;
let TOTAL = 0;
let start = 0;
let bar;

// ================= UTILS =================
function qid(key) {
  return uuidv5(String(key), UUID_NAMESPACE);
}

function buildHash(doc) {
  return JSON.stringify({
    title: doc["OPPORTUNITY TITLE"],
    amount: doc["ESTIMATED TOTAL FUNDING"],
    deadline: doc["ESTIMATED APPLICATION DUE DATE"],
  });
}

// ================= WAIT QDRANT READY =================
async function waitForQdrant() {
  console.log("⏳ Waiting for Qdrant API ready...");

  while (true) {
    try {
      await axios.get(`${QDRANT_URL}/collections`);
      console.log("✅ Qdrant ready");
      return;
    } catch (err) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// ================= ENSURE COLLECTION =================
async function ensureCollection() {
  await waitForQdrant();

  try {
    await qdrant.getCollection(COLLECTION);
    console.log("✅ Collection fund_vectors exists");
  } catch (err) {
    console.log("🚀 Creating collection fund_vectors...");

    await qdrant.createCollection(COLLECTION, {
      vectors: {
        size: VECTOR_SIZE,
        distance: "Cosine",
      },
    });

    console.log("✅ Collection created");
  }
}

// ================= EMBEDDING =================
async function embed(text, retry = RETRY) {
  try {
    const res = await axios.post(`${OLLAMA_BASE}/api/embed`, {
      model: MODEL,
      input: text,
    });

    const vec = res.data?.embeddings?.[0];

    if (!vec || vec.length !== VECTOR_SIZE) {
      throw new Error("Invalid vector");
    }

    return vec;
  } catch (err) {
    if (retry > 0) return embed(text, retry - 1);
    console.error("❌ Embedding failed");
    return null;
  }
}

// ================= PROGRESS =================
function updateBar() {
  const elapsed = (Date.now() - start) / 1000 || 1;
  const speed = (processed / elapsed).toFixed(2);
  const eta = ((TOTAL - processed) / speed).toFixed(0);

  bar.update(processed, {
    speed: `${speed} docs/s`,
    eta,
  });
}

// ================= MAIN =================
async function main() {
  await mongo.connect();
  const db = mongo.db(DB_NAME);

  console.log("🚀 Sync FUND (with progress)...");

  await ensureCollection();

  const docs = await db.collection("fund").find({}).toArray();
  TOTAL = docs.length;

  let updated = 0;
  let skipped = 0;

  start = Date.now();

  bar = new cliProgress.SingleBar({
    format:
      "📊 {bar} {percentage}% | {value}/{total} | ⚡ {speed} | ETA {eta}s",
  });

  bar.start(TOTAL, 0, { speed: "0 docs/s", eta: 0 });

  for (const doc of docs) {
    try {
      const id = qid(doc._id);
      const hash = buildHash(doc);

      let existing = [];

      try {
        existing = await qdrant.retrieve(COLLECTION, {
          ids: [id],
          with_payload: true,
        });
      } catch (err) {
        existing = [];
      }

      if (existing.length > 0) {
        const oldHash = existing[0].payload?.hash;

        if (oldHash === hash) {
          skipped++;
          processed++;
          updateBar();
          continue;
        }
      }

      const text = `
${doc["OPPORTUNITY TITLE"]}
${doc["AGENCY NAME"]}
${doc["FUNDING DESCRIPTION"]}
`;

      const vector = await embed(text);

      if (!vector) {
        processed++;
        updateBar();
        continue;
      }

      await qdrant.upsert(COLLECTION, {
        points: [
          {
            id,
            vector,
            payload: {
              title: doc["OPPORTUNITY TITLE"],
              agency: doc["AGENCY NAME"],
              text: doc["FUNDING DESCRIPTION"],
              deadline: doc["ESTIMATED APPLICATION DUE DATE"],
              amount: doc["ESTIMATED TOTAL FUNDING"],
              url: doc["OPPORTUNITY URL"],
              hash,
            },
          },
        ],
      });

      updated++;
      processed++;
      updateBar();
    } catch (err) {
      console.error("❌ Skip doc:", doc._id);
      processed++;
      updateBar();
    }
  }

  bar.stop();

  console.log(`🎯 DONE → updated=${updated} | skipped=${skipped}`);

  await mongo.close();
}

main();