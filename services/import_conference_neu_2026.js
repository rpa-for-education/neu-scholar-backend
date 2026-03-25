import fs from "fs";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

// ================= CONFIG =================
const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "fitneu";
const COLLECTION = process.env.MONGODB_COLLECTION || "conference";

const FILE_PATH = "./services/hoi_thao_neu_2026.json";

// ================= SAFE KEY =================
function safeKey(item) {
  if (!item._key || typeof item._key !== "string" || item._key.trim() === "") {
    return "gen_" + item.name?.slice(0, 30) + "_" + Date.now();
  }
  return item._key;
}

// ================= MAP =================
function mapToSchema(item) {
  const now = new Date().toISOString();

  return {
    _key: safeKey(item),
    name: item.name,
    acronym: item.acronym || null,

    created_time: now,
    modified_time: now,
    updated_time: now,
    enriched_time: null,

    id_conference: null,
    status: "raw",
    crawl_source: "pdf_neu_2026",

    location: "Vietnam",
    city: "Hanoi",
    country: "Vietnam",
    country_code: "VN",
    continent: "Asia",

    start_date: null,
    deadline: null,
    month: item.month,

    type: item.type,
    organizer: item.organizer,

    cfp_text: null,
    cfp_length: 0,

    topics: [],
    keywords: [],
    vector: [],

    url: null,
    submission_link: null,
  };
}

// ================= CLEAN DB =================
async function cleanDatabase(col) {
  console.log("🧹 Cleaning database...");

  // 1. Fix _key null/missing
  await col.updateMany(
    {},
    [
      {
        $set: {
          _key: {
            $cond: [
              {
                $or: [
                  { $eq: ["$_key", null] },
                  { $not: ["$_key"] },
                  { $eq: [{ $type: "$_key" }, "missing"] }
                ]
              },
              { $concat: ["fix_", { $toString: "$_id" }] },
              "$_key"
            ]
          }
        }
      }
    ]
  );

  // 2. Remove duplicate _key
  const duplicates = await col.aggregate([
    {
      $group: {
        _id: "$_key",
        ids: { $push: "$_id" },
        count: { $sum: 1 }
      }
    },
    {
      $match: { count: { $gt: 1 } }
    }
  ]).toArray();

  for (const doc of duplicates) {
    const idsToDelete = doc.ids.slice(1);
    await col.deleteMany({ _id: { $in: idsToDelete } });
  }

  // 3. Remove invalid records
  await col.deleteMany({
    $or: [
      { name: null },
      { name: "" }
    ]
  });

  console.log("✅ Database cleaned");
}

// ================= INDEX =================
async function setupIndexes(col) {
  console.log("⚙️ Creating indexes...");

  await col.createIndex(
    { _key: 1 },
    {
      unique: true,
      partialFilterExpression: {
        _key: { $type: "string" }
      }
    }
  );

  await col.createIndex({ month: 1, type: 1 });
  await col.createIndex({ organizer: 1 });
  await col.createIndex({ status: 1 });

  await col.createIndex({
    name: "text",
    organizer: "text",
  });

  console.log("✅ Index created");
}

// ================= MAIN =================
async function run() {
  const client = new MongoClient(MONGO_URI);

  try {
    console.log("🚀 Connecting MongoDB...");
    await client.connect();

    const db = client.db(DB_NAME);
    const col = db.collection(COLLECTION);

    // 🔥 CLEAN DB TRƯỚC
    await cleanDatabase(col);

    console.log("📂 Reading JSON...");
    const raw = JSON.parse(fs.readFileSync(FILE_PATH, "utf-8"));

    console.log(`📊 Total: ${raw.length}`);

    // ================= IMPORT =================
    const valid = raw.filter(item => item.name);

    const bulkOps = valid.map((item) => {
      const mapped = mapToSchema(item);

      return {
        updateOne: {
          filter: { _key: mapped._key },
          update: { $set: mapped },
          upsert: true,
        },
      };
    });

    console.log("⚡ Importing...");
    const result = await col.bulkWrite(bulkOps, { ordered: false });

    console.log("✅ DONE!");
    console.log("📌 Inserted:", result.upsertedCount);
    console.log("🔄 Updated:", result.modifiedCount);

    // 🔥 INDEX CUỐI CÙNG
    await setupIndexes(col);

  } catch (err) {
    console.error("❌ ERROR:", err);
  } finally {
    await client.close();
    console.log("🔌 MongoDB closed");
  }
}

run();