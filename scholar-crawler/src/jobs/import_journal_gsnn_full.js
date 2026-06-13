// import_journal_gsnn_full.js

import fs from "fs";
import path from "path";
import crypto from "crypto";
import csv from "csv-parser";
import { fileURLToPath } from "url";

import {
  getDb,
  closeDb
} from "../services/mongo.js";

/* ================= PATH ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FILE_PATH = path.join(
  __dirname,
  "../data/data_gsnnvn.csv"
);

/* ================= HASH ================= */
const genKey = v =>
  crypto
    .createHash("md5")
    .update(String(v))
    .digest("hex");

/* ================= MAIN ================= */
async function run() {
  console.log("🚀 START GSNN IMPORT");
  console.log("📂 FILE:", FILE_PATH);

  const db = await getDb();
  const col = db.collection("journal");

  let processed = 0;
  let batch = [];

  const stream = fs
    .createReadStream(FILE_PATH)
    .pipe(csv());

  for await (const row of stream) {
    const u_key = genKey(
      row.issn || row.title
    );

    batch.push({
      updateOne: {
        filter: {
          u_key
        },
        update: {
          $set: {
            u_key,
            title: row.title,
            issn: row.issn,
            updatedAt: new Date()
          },
          $setOnInsert: {
            createdAt: new Date()
          }
        },
        upsert: true
      }
    });

    processed++;

    if (batch.length >= 500) {
      await col.bulkWrite(batch);
      batch = [];
    }

    if (processed % 1000 === 0) {
      console.log(
        `📊 Processed: ${processed}`
      );
    }
  }

  if (batch.length) {
    await col.bulkWrite(batch);
  }

  console.log(
    `📊 Total rows: ${processed}`
  );

  console.log("🎯 GSNN DONE");
}

run()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async err => {
    console.error(
      "❌ GSNN IMPORT ERROR"
    );

    console.error(err);

    try {
      await closeDb();
    } catch {}

    process.exit(1);
  });