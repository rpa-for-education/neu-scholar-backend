import fs from "fs";
import path from "path";
import crypto from "crypto";
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
  "../data/data_gsnnvn.csv"
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
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const v = String(value)
    .trim()
    .toLowerCase();

  if (v === "true") return true;
  if (v === "false") return false;
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
  console.log("🚀 START GSNN IMPORT");
  console.log("📂 FILE:", FILE_PATH);

  const db = await getDb();
  const col = db.collection("journal");

  let processed = 0;
  let inserted = 0;
  let batch = [];

  const stream = fs
    .createReadStream(FILE_PATH)
    .pipe(csv());

  for await (const rawRow of stream) {
    const row =
      normalizeRow(rawRow);

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

      country:
        row.country ||
        null,

      region:
        row.region ||
        null,

      categories:
        row.categories ||
        null,

      areas:
        row.areas || null,

      field:
        row.field || null,

      rank:
        parseNum(
          row.rank
        ),

      sjr:
        parseNum(
          row.sjr
        ),

      quartile:
        row.sjr_best_quartile ||
        null,

      h_index:
        parseNum(
          row.h_index
        ),

      total_docs_2024:
        parseNum(
          row.total_docs_2024
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

      sdg:
        row.sdg || null,

      coverage:
        row.coverage ||
        null,

      open_access:
        parseBool(
          row.open_access
        ),

      open_access_diamond:
        parseBool(
          row.open_access_diamond
        ),

      vn_professor_council:
        parseBool(
          row.vn_professor_council
        ),

      source:
        "gsnnvn",

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

    processed++;

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
      processed % 1000 ===
      0
    ) {
      console.log(
        `📊 Processed: ${processed}`
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
    `📊 Total rows: ${processed}`
  );

  console.log(
    `➕ New records: ${inserted}`
  );

  console.log("🎯 GSNN DONE");
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
      "❌ GSNN IMPORT ERROR"
    );

    console.error(err);

    try {
      await closeDb();
    } catch {}

    process.exit(1);
  });