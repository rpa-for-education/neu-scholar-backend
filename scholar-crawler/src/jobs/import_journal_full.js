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
const genKey = value =>
  crypto
    .createHash("md5")
    .update(String(value))
    .digest("hex");

const parseNum = value => {
  if (!value) return null;

  const n = Number(
    String(value)
      .replace(/"/g, "")
      .replace(",", ".")
  );

  return Number.isNaN(n) ? null : n;
};

function normalizeRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.trim().toLowerCase(),
      v
    ])
  );
}

/* ================= MAIN ================= */
async function run() {
  console.log("🚀 START JOURNAL IMPORT");
  console.log("📂 FILE:", FILE_PATH);

  const db = await getDb();
  const col = db.collection("journal");

  let total = 0;
  let inserted = 0;
  let batch = [];

  const stream = fs
    .createReadStream(FILE_PATH)
    .pipe(
      csv({
        separator: ";"
      })
    );

  for await (const rawRow of stream) {
    const row = normalizeRow(rawRow);

    total++;

    const sourceId =
      row.sourceid ||
      row.issn ||
      row.title;

    const u_key = genKey(sourceId);

    batch.push({
      updateOne: {
        filter: { u_key },

        update: {
          $set: {
            u_key,

            sourceid: row.sourceid || null,
            title: row.title || null,
            type: row.type || null,
            issn: row.issn || null,

            publisher:
              row.publisher || null,

            country:
              row.country || null,

            region:
              row.region || null,

            sjr: parseNum(row.sjr),

            quartile:
              row["sjr best quartile"] ||
              null,

            h_index: parseNum(
              row["h index"]
            ),

            categories:
              row.categories || null,

            areas:
              row.areas || null,

            coverage:
              row.coverage || null,

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
      const result =
        await col.bulkWrite(batch);

      inserted +=
        result.upsertedCount || 0;

      batch = [];
    }

    if (total % 10000 === 0) {
      console.log(
        `📊 Processed: ${total}`
      );
    }
  }

  if (batch.length) {
    const result =
      await col.bulkWrite(batch);

    inserted +=
      result.upsertedCount || 0;
  }

  console.log(
    `📊 Total rows: ${total}`
  );

  console.log(
    `➕ New records: ${inserted}`
  );

  console.log("🎯 JOURNAL DONE");
}

run()
  .then(async () => {
    await closeDb();

    console.log("🔒 Mongo closed");

    process.exit(0);
  })
  .catch(async err => {
    console.error(
      "❌ JOURNAL IMPORT ERROR"
    );

    console.error(err);

    try {
      await closeDb();
    } catch {}

    process.exit(1);
  });