import crypto from "crypto";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

// ================= CONFIG =================
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || "rpa";
const COLLECTION = "conference";

const client = new MongoClient(MONGO_URI);

// ================= UTIL =================
const hash = (str) =>
  crypto.createHash("md5").update(str).digest("hex");

function generateEnrichHash(enrich) {
  return hash(JSON.stringify(enrich));
}

// ================= ENRICH LOGIC =================
function enrichDoc(doc) {
  // 👉 thay bằng AI / NLP / API thật
  return {
    core_rank: guessRank(doc.acronym),
    topics: extractTopics(doc.title),
    score: Math.random().toFixed(2)
  };
}

function guessRank(acronym = "") {
  if (!acronym) return "C";
  if (acronym.includes("ICML")) return "A*";
  if (acronym.includes("NeurIPS")) return "A*";
  return "B";
}

function extractTopics(title = "") {
  if (!title) return [];
  return title.split(" ").slice(0, 3);
}

// ================= MAIN =================
async function run() {
  console.log("🚀 ENRICH START");

  await client.connect();
  const col = client.db(DB_NAME).collection(COLLECTION);

  const cursor = col.find({
    isActive: true
  });

  let updated = 0;
  let skipped = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();

    const enriched = enrichDoc(doc);
    const enrich_hash = generateEnrichHash(enriched);

    if (doc.enrich_hash === enrich_hash) {
      skipped++;
      continue;
    }

    await col.updateOne(
      { _id: doc._id },
      {
        $set: {
          ...enriched,
          enrich_hash,
          enrichedAt: new Date()
        }
      }
    );

    updated++;
  }

  console.log(`
📊 ENRICH RESULT
🔄 Updated: ${updated}
⏭️ Skipped: ${skipped}
  `);

  await client.close();
}

run();