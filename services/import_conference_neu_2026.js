import fs from "fs";
import crypto from "crypto";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

// ================= CONFIG =================
const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "fitneu";
const COLLECTION = process.env.MONGODB_COLLECTION || "conference";

const FILE_PATH = "./services/hoi_thao_neu_2026.json";

// ================= NORMALIZE =================
function normalizeText(text) {
  return text
    ?.toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ================= YEAR =================
function extractYear(text) {
  const match = text?.match(/\b20\d{2}\b/);
  return match ? parseInt(match[0]) : 2026;
}

// ================= SERIES =================
function extractSeries(acronym, name) {
  if (acronym) return acronym.replace(/\d{4}/, "").trim();
  return name.split(" ").slice(0, 3).join(" ").toUpperCase();
}

// ================= KEY =================
function generateKey(item) {
  const base = `${item.normalized_name}_${item.year}_${item.normalized_organizer}`;
  return crypto.createHash("md5").update(base).digest("hex");
}

// ================= TOPIC DICTIONARY =================
const TOPIC_KEYWORDS = {
  ai: ["ai", "artificial intelligence", "machine learning"],
  economics: ["economics", "economic", "finance"],
  management: ["management", "business"],
  education: ["education", "learning"],
  data: ["data", "big data"],
  technology: ["technology", "it"],
  innovation: ["innovation", "startup"],
};

// ================= EXTRACT TOPICS =================
function extractTopics(text) {
  const normalized = normalizeText(text);
  const found = [];

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some(k => normalized.includes(k))) {
      found.push(topic);
    }
  }

  return found;
}

// ================= MAP =================
function mapToDoc(item) {
  const now = new Date().toISOString();

  const normalized_name = normalizeText(item.name);
  const normalized_organizer = normalizeText(item.organizer);

  const year = extractYear(item.name || item.acronym);
  const series = extractSeries(item.acronym, item.name);

  const baseOrg = item.organizer || "";
  const organizer_full = `${baseOrg} - Đại học Kinh tế Quốc dân`;

  // 🔥 EXTRACT TOPICS
  const topics = extractTopics(item.name);

  const typeText =
    item.type === "Quốc tế"
      ? "hội thảo quốc tế"
      : "hội thảo quốc gia";

  const topicText =
    topics.length > 0
      ? `Các chủ đề bao gồm ${topics.join(", ")}.`
      : "";

  // 🔥 CFP TEXT CHUẨN AI
  const cfp_text = `${item.name}${
    item.acronym ? ` (${item.acronym})` : ""
  } là ${typeText} được tổ chức bởi ${organizer_full} tại Đại học Kinh tế Quốc dân, Hà Nội, Việt Nam vào tháng ${item.month} năm ${year}. ${topicText}`;

  const _key = generateKey({
    normalized_name,
    normalized_organizer,
    year,
  });

  return {
    _key,

    name: item.name,
    acronym: item.acronym || null,

    normalized_name,
    normalized_organizer,

    series,
    year,

    type: item.type,
    organizer: baseOrg,
    organizer_full,

    institution: "Đại học Kinh tế Quốc dân",
    institution_code: "NEU",

    month: item.month,

    location: "Vietnam",
    city: "Hanoi",
    country: "Vietnam",

    status: "neu_2026",
    crawl_source: "neu_pdf",

    // 🔥 IMPORTANT
    cfp_text,
    cfp_length: cfp_text.length,
    topics,

    keywords: [],
    vector: [],

    updated_time: now,
  };
}

// ================= INDEX =================
async function setupIndexes(col) {
  const indexes = await col.indexes();

  if (!indexes.some(i => i.key?._key === 1)) {
    await col.createIndex({ _key: 1 }, { unique: true });
  }

  if (!indexes.some(i => i.key?.series === 1)) {
    await col.createIndex({ series: 1, year: 1 });
  }

  if (!indexes.some(i => i.key?.institution_code === 1)) {
    await col.createIndex({ institution_code: 1 });
  }

  console.log("✅ Index ready");
}

// ================= MAIN =================
async function run() {
  const client = new MongoClient(MONGO_URI);

  try {
    console.log("🚀 Connecting MongoDB...");
    await client.connect();

    const col = client.db(DB_NAME).collection(COLLECTION);

    await setupIndexes(col);

    const raw = JSON.parse(fs.readFileSync(FILE_PATH, "utf-8"));

    const bulkOps = [];
    const now = new Date().toISOString();

    for (const item of raw) {
      if (!item.name) continue;

      const doc = mapToDoc(item);

      bulkOps.push({
        updateOne: {
          filter: {
            normalized_name: doc.normalized_name,
            year: doc.year,
          },
          update: {
            $set: {
              ...doc,
              updated_time: now,
            },
            $setOnInsert: {
              created_time: now,
            },
            $addToSet: {
              sources: doc.crawl_source,
            },
          },
          upsert: true,
        },
      });
    }

    const result = await col.bulkWrite(bulkOps, { ordered: false });

    console.log("🎯 DONE");
    console.log("🆕 Inserted:", result.upsertedCount);
    console.log("🔄 Updated:", result.modifiedCount);

  } catch (err) {
    console.error("❌ ERROR:", err);
  } finally {
    await client.close();
  }
}

run();