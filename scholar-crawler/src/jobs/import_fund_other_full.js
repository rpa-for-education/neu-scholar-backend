// import_fund_other_full.js

import fs from "fs";
import path from "path";
import csv from "csv-parser";
import { fileURLToPath } from "url";

import {
  getDb,
  closeDb
} from "../services/mongo.js";

/* ================= CONFIG ================= */
const BATCH_SIZE = 500;

/* ================= PATH ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FILE_PATH = path.join(
  __dirname,
  "../data/data_other_funds.csv"
);

/* ================= MAIN ================= */
async function run() {
  console.log("🚀 START OTHER FUND IMPORT");
  console.log("📂 FILE:", FILE_PATH);

  const db = await getDb();
  const col = db.collection("fund");

  let processed = 0;
  let skipped = 0;
  let batch = [];

  const stream = fs
    .createReadStream(FILE_PATH)
    .pipe(csv());

  for await (const row of stream) {
    if (!row.url) {
      skipped++;
      continue;
    }

    const now = new Date();

    batch.push({
      updateOne: {
        filter: {
          url: row.url
        },
        update: {
          $set: {
            title: row.opportunity_title || null,
            updatedAt: now
          },
          $setOnInsert: {
            createdAt: now
          }
        },
        upsert: true
      }
    });

    processed++;

    if (batch.length >= BATCH_SIZE) {
      await col.bulkWrite(batch, {
        ordered: false
      });

      batch = [];
    }

    if (processed % 1000 === 0) {
      console.log(
        `📊 Processed: ${processed}`
      );
    }
  }

  if (batch.length > 0) {
    await col.bulkWrite(batch, {
      ordered: false
    });
  }

  console.log(
    `📊 Total processed: ${processed}`
  );

  console.log(
    `⏭️ Skipped: ${skipped}`
  );

  console.log("🎯 OTHER FUND DONE");
}

run()
  .then(async () => {
    try {
      await closeDb();
    } catch {}

    process.exit(0);
  })
  .catch(async err => {
    console.error(
      "❌ OTHER FUND ERROR"
    );

    console.error(err);

    try {
      await closeDb();
    } catch {}

    process.exit(1);
  });