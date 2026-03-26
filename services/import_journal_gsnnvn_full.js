// import_journal_gsnnvn_full.js
import fs from "fs";
import readline from "readline";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

// ================= CONFIG =================
const FILE_PATH = "./services/data_gsnnvn.csv";
const BATCH_SIZE = 500;

const client = new MongoClient(process.env.MONGO_URI);
const DB = process.env.DB_NAME;

// ================= HELPER =================
const genKey = (v) =>
  crypto.createHash("md5").update(String(v)).digest("hex");

const clean = (v) =>
  typeof v === "string" ? v.trim() || null : v ?? null;

const parseBool = (v) => {
  if (v === "true" || v === true) return true;
  if (v === "false" || v === false) return false;
  return null;
};

// 🔥 ISSN chuẩn (quan trọng nhất)
function getPrimaryIssn(issn) {
  if (!issn) return null;
  return issn.split(";")[0].trim();
}

// build search text
function buildText(r) {
  return [
    r.title,
    r.publisher,
    r.categories,
    r.areas,
    r.country,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// ================= MAP =================
function mapRow(r) {
  const primaryIssn = getPrimaryIssn(r.issn);

  return {
    u_key: genKey(primaryIssn || r.title.toLowerCase()),

    sourceid: clean(r.sourceid),
    title: clean(r.title),
    type: clean(r.type),

    issn: clean(r.issn),
    primary_issn: primaryIssn,

    publisher: clean(r.publisher),
    country: clean(r.country),
    region: clean(r.region),

    categories: clean(r.categories),
    areas: clean(r.areas),

    // 🔥 CHỈ giữ field đơn
    field: clean(r.field),

    coverage: clean(r.coverage),

    open_access: parseBool(r.open_access),
    open_access_diamond: parseBool(r.open_access_diamond),

    vn_professor_council: parseBool(r.vn_professor_council),

    text: buildText(r),
    raw: r,

    updatedAt: new Date(),
  };
}

// ================= MAIN =================
async function run() {
  console.log("🚀 IMPORT GSNN DATASET");

  await client.connect();
  const col = client.db(DB).collection("journal");

  // 🔥 INDEX
  await col.createIndex({ u_key: 1 }, { unique: true });
  await col.createIndex({ primary_issn: 1 });

  const rl = readline.createInterface({
    input: fs.createReadStream(FILE_PATH),
    crlfDelay: Infinity,
  });

  let batch = [];
  let total = 0;
  let inserted = 0;
  let updated = 0;

  let headers = null;

  for await (const line of rl) {
    // 🔥 skip comment
    if (!line || line.startsWith("#")) continue;

    // header
    if (!headers) {
      headers = line.split(",");
      continue;
    }

    const values = line.split(",");

    let row = {};
    headers.forEach((h, i) => {
      row[h.trim()] = values[i]?.trim();
    });

    const data = mapRow(row);

    batch.push({
      updateOne: {
        filter: { u_key: data.u_key },
        update: {
          $set: {
            ...data,
            updatedAt: new Date(),
          },

          $setOnInsert: {
            createdAt: new Date(),
          },

          // 🔥 MERGE FIELD (KHÔNG CONFLICT)
          $addToSet: {
            fields: { $each: data.field ? [data.field] : [] },
          },
        },
        upsert: true,
      },
    });

    if (batch.length >= BATCH_SIZE) {
      const res = await col.bulkWrite(batch);

      inserted += res.upsertedCount;
      updated += res.modifiedCount;
      total += batch.length;

      console.log("⚡ batch:", { total, inserted, updated });

      batch = [];
    }
  }

  if (batch.length) {
    const res = await col.bulkWrite(batch);

    inserted += res.upsertedCount;
    updated += res.modifiedCount;
    total += batch.length;
  }

  console.log("🎯 DONE");
  console.log("🆕 Insert:", inserted);
  console.log("🔄 Update:", updated);
  console.log("📦 Total:", total);

  await client.close();
}

run();