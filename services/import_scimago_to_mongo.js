import fs from "fs";
import csv from "csv-parser";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const client = new MongoClient(process.env.MONGODB_URI);

// ===== CONFIG =====
const BATCH_SIZE = 1000;

// ===== Utils =====
function normalizeNumber(value) {
  if (!value) return null;
  return parseFloat(value.replace(",", ".")) || null;
}

function normalizeString(value) {
  if (!value) return null;
  return value.trim();
}

// 👉 lọc sourceid rác
function isValidSourceId(id) {
  return id && id !== "2147483647";
}

// ===== count dòng =====
async function countLines(filePath) {
  return new Promise((resolve) => {
    let count = 0;
    fs.createReadStream(filePath)
      .on("data", (buf) => {
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] === 10) count++;
        }
      })
      .on("end", () => resolve(count - 1));
  });
}

// ===== MAIN =====
async function run() {
  await client.connect();
  console.log("✅ MongoDB connected");

  const db = client.db(process.env.DB_NAME || "fitneu");
  const col = db.collection(process.env.COLLECTION_NAME || "journal");

  const totalRows = await countLines(process.env.CSV_FILE);
  console.log(`📊 Total rows: ${totalRows}`);

  let processed = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  let bulkOps = [];

  const stream = fs
    .createReadStream(process.env.CSV_FILE)
    .pipe(csv({ separator: ";" }));

  for await (const row of stream) {
    try {
      const sourceid = normalizeString(row.Sourceid);

      // ❌ skip data rác ngay từ đầu
      if (!isValidSourceId(sourceid)) {
        skipped++;
        continue;
      }

      const doc = {
        title: normalizeString(row.Title),
        publisher: normalizeString(row.Publisher),
        country: normalizeString(row.Country),
        region: normalizeString(row.Region),

        categories: normalizeString(row.Categories),
        areas: normalizeString(row.Areas),

        issn: normalizeString(row.Issn),

        sjr: normalizeNumber(row.SJR),
        sjr_best_quartile: normalizeString(row["SJR Best Quartile"]),

        h_index: normalizeNumber(row["H index"]),
        total_docs_3_years: normalizeNumber(row["Total Docs. (3years)"]),
        total_refs: normalizeNumber(row["Total Refs."]),

        citeable_docs_3_years: normalizeNumber(
          row["Citable Docs. (3years)"]
        ),
        total_citations_3_years: normalizeNumber(
          row["Total Cites (3years)"]
        ),

        ref_doc: normalizeNumber(row["Ref. / Doc."]),
        coverage: normalizeString(row.Coverage),

        sourceid,

        scimago_link: `https://www.scimagojr.com/journalsearch.php?q=${sourceid}&tip=sid`,

        type: "journal",
        updated_time: new Date().toISOString(),
      };

      // ===== BULK UPSERT =====
      bulkOps.push({
        updateOne: {
          filter: { sourceid },
          update: {
            $set: doc,
            $setOnInsert: {
              created_time: new Date().toISOString(),
            },
          },
          upsert: true,
        },
      });

      processed++;

      // ===== EXECUTE BATCH =====
      if (bulkOps.length >= BATCH_SIZE) {
        const result = await col.bulkWrite(bulkOps, { ordered: false });

        inserted += result.upsertedCount || 0;
        updated += result.modifiedCount || 0;

        bulkOps = [];

        const percent = ((processed / totalRows) * 100).toFixed(2);

        console.log(
          `⏳ ${processed}/${totalRows} (${percent}%) | 🆕 ${inserted} | 🔄 ${updated} | ⏭️ ${skipped}`
        );
      }
    } catch (err) {
      console.error("❌ Row error:", err);
    }
  }

  // ===== flush batch cuối =====
  if (bulkOps.length > 0) {
    const result = await col.bulkWrite(bulkOps, { ordered: false });

    inserted += result.upsertedCount || 0;
    updated += result.modifiedCount || 0;
  }

  console.log("\n🎯 DONE");
  console.log(`🆕 Inserted: ${inserted}`);
  console.log(`🔄 Updated: ${updated}`);
  console.log(`⏭️ Skipped: ${skipped}`);

  // ===============================
  // 🔥 FIX CHUẨN: CLEAN + INDEX
  // ===============================

  console.log("\n🧹 Removing invalid sourceid...");

  const deleteResult = await col.deleteMany({
    $or: [
      { sourceid: "2147483647" },
      { sourceid: null },
      { sourceid: "" },
    ],
  });

  console.log(`🗑️ Removed: ${deleteResult.deletedCount}`);

  console.log("🔧 Creating unique index...");

  await col.createIndex(
    { sourceid: 1 },
    {
      unique: true,
      background: true,
    }
  );

  console.log("✅ Index created");

  await client.close();
}

run();