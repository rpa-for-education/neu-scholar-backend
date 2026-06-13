// import_fund_full.js

import fs from "fs";
import path from "path";
import csv from "csv-parser";
import crypto from "crypto";
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
  "../data/grants-search-202606130703.csv"
);

/* ================= HASH ================= */
const genKey = v =>
  crypto
    .createHash("md5")
    .update(String(v))
    .digest("hex");

/* ================= MAIN ================= */
async function run() {
  console.log("🚀 START FUND IMPORT");
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
    const id =
      row.opportunity_id ||
      row.url;

    if (!id) {
      skipped++;
      continue;
    }

    const u_key = genKey(id);
    const now = new Date();

    batch.push({
      updateOne: {
        filter: {
          u_key
        },
        update: {
          $set: {
            u_key,
            title:
              row.opportunity_title ||
              null,
            agency:
              row.agency_name ||
              null,
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

  console.log("🎯 FUND DONE");
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
      "❌ FUND IMPORT ERROR"
    );

    console.error(err);

    try {
      await closeDb();
    } catch {}

    process.exit(1);
  });