// import_journal_full.js

import fs from "fs";
import path from "path";
import csv from "csv-parser";
import crypto from "crypto";
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
  "../data/data_scimagojr_2025.csv"
);

const BATCH_SIZE = 500;

/* ================= HELPERS ================= */
const genKey = v =>
  crypto
    .createHash("md5")
    .update(String(v))
    .digest("hex");

const parseNum = v => {
  if (!v) return null;

  const n = Number(
    String(v).replace(/,/g, "")
  );

  return isNaN(n) ? null : n;
};

/* ================= MAIN ================= */
async function run() {
  console.log("🚀 START JOURNAL IMPORT");
  console.log("📂 FILE:", FILE_PATH);

  const db = await getDb();
  const col = db.collection("journal");

  let batch = [];
  let total = 0;

  const stream = fs
    .createReadStream(FILE_PATH)
    .pipe(
      csv({
        separator: ";"
      })
    );

  for await (const row of stream) {
    total++;

    const u_key = genKey(
      row.sourceid || row.title
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
            publisher: row.publisher,
            country: row.country,
            sjr: parseNum(row.sjr),
            updatedAt: new Date()
          },
          $setOnInsert: {
            createdAt: new Date()
          }
        },
        upsert: true
      }
    });

    if (batch.length >= BATCH_SIZE) {
      await col.bulkWrite(batch);
      batch = [];
    }

    if (total % 10000 === 0) {
      console.log(
        `📊 Processed: ${total}`
      );
    }
  }

  if (batch.length) {
    await col.bulkWrite(batch);
  }

  console.log(
    `📊 Total rows: ${total}`
  );

  console.log("🎯 JOURNAL DONE");
}

run()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async err => {
    console.error(
      "❌ JOURNAL IMPORT ERROR"
    );

    console.error(err);

    await closeDb();

    process.exit(1);
  });