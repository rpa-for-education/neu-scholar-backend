// import_conference_neu.js

import fs from "fs";
import csv from "csv-parser";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

/* ================= ENV CHECK ================= */
if (!process.env.MONGODB_URI) {
  throw new Error(
    "❌ Missing MONGODB_URI in .env"
  );
}

/* ================= PATH ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FILE_PATH = path.join(
  __dirname,
  "../data/data_hoi_thao_neu_2026.csv"
);

/* ================= HASH ================= */
function buildHash(doc) {
  return crypto
    .createHash("md5")
    .update(
      JSON.stringify({
        _key: doc._key,
        acronym: doc.acronym,
        name: doc.name,
        location: doc.location,
        city: doc.city,
        country: doc.country,
        country_code: doc.country_code,
        continent: doc.continent,
        deadline: doc.deadline,
        start_date: doc.start_date,
        topics: doc.topics,
        url: doc.url
      })
    )
    .digest("hex");
}

/* ================= TOPICS ================= */
function parseTopics(topics) {
  if (!topics) return [];

  return topics
    .split(",")
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);
}

/* ================= MAIN ================= */
async function run() {
  console.log("📂 Reading file:", FILE_PATH);

  const client = new MongoClient(
    process.env.MONGODB_URI
  );

  try {
    await client.connect();

    console.log("✅ Mongo connected");

    const col = client
      .db(process.env.DB_NAME || "fitneu")
      .collection("conference");

    const rows = [];

    await new Promise((resolve, reject) => {
      fs.createReadStream(FILE_PATH)
        .pipe(csv())
        .on("data", data => rows.push(data))
        .on("end", resolve)
        .on("error", reject);
    });

    console.log(
      `📊 Loaded rows: ${rows.length}`
    );

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const topics = parseTopics(
          row.topics
        );

        const baseDoc = {
          _key: row._key,
          acronym: row.acronym,
          name: row.name,
          location: row.location,
          city: row.city,
          country: row.country,
          country_code: row.country_code,
          continent: row.continent,
          deadline:
            row.deadline || null,
          start_date:
            row.start_date,
          topics,
          url: row.url || null
        };

        const newHash =
          buildHash(baseDoc);

        const existing =
          await col.findOne({
            _key: row._key
          });

        /* ===== INSERT ===== */
        if (!existing) {
          await col.insertOne({
            ...baseDoc,
            cfp_text:
              row.cfp_text || "",
            crawl_source:
              row.crawl_source ||
              "neu",
            hash: newHash,
            status:
              row.status ||
              "pending",
            created_time:
              new Date(),
            updated_time:
              new Date()
          });

          inserted++;
          continue;
        }

        /* ===== SKIP ===== */
        if (
          existing.hash ===
          newHash
        ) {
          skipped++;
          continue;
        }

        /* ===== UPDATE ===== */
        await col.updateOne(
          {
            _key: row._key
          },
          {
            $set: {
              ...baseDoc,

              // giữ dữ liệu crawl
              cfp_text:
                existing.cfp_text ||
                row.cfp_text ||
                "",

              crawl_source:
                row.crawl_source ||
                existing.crawl_source ||
                "neu",

              hash: newHash,

              status:
                existing.status ||
                "pending",

              updated_time:
                new Date()
            }
          }
        );

        updated++;
      } catch (err) {
        console.error(
          "❌ Error row:",
          row._key
        );

        console.error(err.message);
      }
    }

    console.log("\n🎯 DONE");
    console.log(
      "➕ Inserted:",
      inserted
    );
    console.log(
      "🔄 Updated:",
      updated
    );
    console.log(
      "⏭️ Skipped:",
      skipped
    );
  } finally {
    await client.close();

    console.log("🔒 Mongo closed");
  }
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error(
      "❌ IMPORT ERROR"
    );

    console.error(err);

    process.exit(1);
  });