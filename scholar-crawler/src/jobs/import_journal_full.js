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
  "../data/data_scimagojr_2025.csv"
);

/* ================= HELPERS ================= */
const genKey = value =>
  crypto
    .createHash("md5")
    .update(String(value))
    .digest("hex");

const parseNum = value => {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const n = Number(
    String(value)
      .replace(/"/g, "")
      .replace(",", ".")
      .trim()
  );

  return Number.isNaN(n)
    ? null
    : n;
};

const parseBool = value => {
  if (!value) return null;

  const v = String(value)
    .trim()
    .toLowerCase();

  if (v === "yes") return true;
  if (v === "no") return false;

  return null;
};

function normalizeRow(row) {
  const doc = {};

  for (const [key, value] of Object.entries(
    row
  )) {
    const normalizedKey = key
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");

    doc[normalizedKey] =
      value === ""
        ? null
        : value;
  }

  return doc;
}

/* ================= MAIN ================= */
async function run() {
  console.log(
    "🚀 START JOURNAL IMPORT"
  );

  console.log(
    "📂 FILE:",
    FILE_PATH
  );

  const db = await getDb();
  const col =
    db.collection("journal");

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
    const row =
      normalizeRow(rawRow);

    total++;

    const sourceId =
      row.sourceid ||
      row.issn ||
      row.title;

    if (!sourceId) {
      continue;
    }

    const u_key =
      genKey(sourceId);

    const now = new Date();

    const doc = {
      ...row,

      u_key,

      rank: parseNum(
        row.rank
      ),

      sourceid:
        row.sourceid ||
        null,

      title:
        row.title || null,

      type:
        row.type || null,

      issn:
        row.issn || null,

      publisher:
        row.publisher ||
        null,

      open_access:
        parseBool(
          row.open_access
        ),

      open_access_diamond:
        parseBool(
          row.open_access_diamond
        ),

      sjr: parseNum(
        row.sjr
      ),

      quartile:
        row.sjr_best_quartile ||
        null,

      h_index: parseNum(
        row.h_index
      ),

      total_docs_2025:
        parseNum(
          row.total_docs_2025
        ),

      total_docs_3years:
        parseNum(
          row.total_docs_3years
        ),

      total_refs:
        parseNum(
          row.total_refs
        ),

      total_citations_3years:
        parseNum(
          row.total_citations_3years
        ),

      citable_docs_3years:
        parseNum(
          row.citable_docs_3years
        ),

      citations_per_doc_2years:
        parseNum(
          row
            .citations_doc_2years
        ),

      refs_per_doc:
        parseNum(
          row.ref_doc
        ),

      female_percent:
        parseNum(
          row.female
        ),

      overton:
        parseNum(
          row.overton
        ),

      country:
        row.country ||
        null,

      region:
        row.region ||
        null,

      coverage:
        row.coverage ||
        null,

      categories:
        row.categories ||
        null,

      areas:
        row.areas || null,

      updatedAt: now
    };

    batch.push({
      updateOne: {
        filter: {
          u_key
        },

        update: {
          $set: doc,

          $setOnInsert: {
            createdAt: now
          }
        },

        upsert: true
      }
    });

    if (
      batch.length >=
      BATCH_SIZE
    ) {
      const result =
        await col.bulkWrite(
          batch,
          {
            ordered: false
          }
        );

      inserted +=
        result.upsertedCount ||
        0;

      batch = [];
    }

    if (
      total % 10000 ===
      0
    ) {
      console.log(
        `📊 Processed: ${total}`
      );
    }
  }

  if (batch.length) {
    const result =
      await col.bulkWrite(
        batch,
        {
          ordered: false
        }
      );

    inserted +=
      result.upsertedCount ||
      0;
  }

  console.log(
    `📊 Total rows: ${total}`
  );

  console.log(
    `➕ New records: ${inserted}`
  );

  console.log(
    "🎯 JOURNAL DONE"
  );
}

run()
  .then(async () => {
    try {
      await closeDb();
    } catch {}

    console.log(
      "🔒 Mongo closed"
    );

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