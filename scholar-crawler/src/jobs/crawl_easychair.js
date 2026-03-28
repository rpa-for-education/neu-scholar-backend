import crypto from "crypto";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

// ================= CONFIG =================
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || "rpa";
const COLLECTION = "conference";
const SOURCE = "easychair";
const BATCH_SIZE = 500;

const client = new MongoClient(MONGO_URI);

// ================= UTIL =================
const hash = (str) =>
  crypto.createHash("md5").update(str).digest("hex");

function generateExternalId(doc) {
  return hash(doc.link || doc.title);
}

function extractYear(text = "") {
  const match = text.match(/20\d{2}/);
  return match ? Number(match[0]) : null;
}

function normalizeDoc(raw) {
  return {
    title: raw.title?.trim(),
    acronym: raw.acronym?.trim(),
    link: raw.link,
    location: raw.location || "",
    year: raw.year || extractYear(raw.title)
  };
}

function generateRawHash(doc) {
  const base = {
    title: doc.title,
    acronym: doc.acronym,
    link: doc.link,
    location: doc.location,
    year: doc.year
  };
  return hash(JSON.stringify(base));
}

// ================= BULK UPSERT RAW =================
async function bulkUpsertRaw(col, docs) {
  const ops = [];

  for (const raw of docs) {
    const doc = normalizeDoc(raw);
    if (!doc.title) continue;

    const external_id = generateExternalId(doc);
    const raw_hash = generateRawHash(doc);

    ops.push({
      updateOne: {
        filter: {
          source: SOURCE,
          external_id
        },
        update: [
          {
            $set: {
              // RAW fields only
              ...doc,
              source: SOURCE,
              external_id,
              raw_hash,
              isActive: true,
              updatedAt: new Date()
            }
          },
          {
            $setOnInsert: {
              createdAt: new Date()
            }
          }
        ],
        upsert: true
      }
    });
  }

  if (!ops.length) return { inserted: 0, updated: 0 };

  const res = await col.bulkWrite(ops, { ordered: false });

  return {
    inserted: res.upsertedCount || 0,
    updated: res.modifiedCount || 0
  };
}

// ================= MAIN =================
async function run() {
  console.log("🚀 RAW CRAWLER START");

  await client.connect();
  const col = client.db(DB_NAME).collection(COLLECTION);

  // 👉 TODO: thay bằng crawler thật
  const crawled = await crawlEasyChairFull();

  let inserted = 0;
  let updated = 0;

  for (let i = 0; i < crawled.length; i += BATCH_SIZE) {
    const chunk = crawled.slice(i, i + BATCH_SIZE);

    const res = await bulkUpsertRaw(col, chunk);

    inserted += res.inserted;
    updated += res.updated;
  }

  // ===== mark inactive =====
  const seenIds = crawled.map(d =>
    generateExternalId(normalizeDoc(d))
  );

  await col.updateMany(
    {
      source: SOURCE,
      external_id: { $nin: seenIds }
    },
    {
      $set: { isActive: false }
    }
  );

  console.log(`
📊 RAW RESULT
🆕 Inserted: ${inserted}
🔄 Updated: ${updated}
  `);

  await client.close();
}

// ================= MOCK =================
async function crawlEasyChairFull() {
  return [
    {
      title: "ICML 2026",
      acronym: "ICML",
      link: "https://icml.cc",
      location: "USA"
    },
    {
      title: "NeurIPS 2026",
      acronym: "NeurIPS",
      link: "https://neurips.cc",
      location: "Canada"
    }
  ];
}

run();