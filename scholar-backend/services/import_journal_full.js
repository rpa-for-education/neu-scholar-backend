// import_journal_full.js
import fs from "fs";
import csv from "csv-parser";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

// ================= CONFIG =================
const FILE_PATH = "./services/data_scimagojr 2024.csv";
const BATCH_SIZE = 500;

const client = new MongoClient(process.env.MONGO_URI);
const DB = process.env.DB_NAME;

// ================= HELPER =================
const genKey = (v) =>
  crypto.createHash("md5").update(String(v)).digest("hex");

const clean = (v) =>
  typeof v === "string" ? v.trim() || null : v ?? null;

// 🔥 FIX: parseNum robust hơn
const parseNum = (v) => {
  if (v === undefined || v === null) return null;
  const str = String(v).trim();
  if (str === "") return null;
  const n = Number(str.replace(/,/g, ""));
  return isNaN(n) ? null : n;
};

function normalizeHeader(h) {
  return h
    .toLowerCase()
    .replace(/\ufeff/g, "")
    .replace(/[().%/]/g, "")
    .replace(/\s+/g, "_")
    .trim();
}

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

// 🔥 NEW: build link trực tiếp
function buildScimagoLink(sourceid) {
  if (!sourceid) return null;
  return `https://www.scimagojr.com/journalsearch.php?q=${sourceid}&tip=sid`;
}

// ================= MAP =================
function mapRow(r) {
  return {
    u_key: genKey(r.sourceid || r.title),

    sourceid: clean(r.sourceid),
    title: clean(r.title),
    type: clean(r.type),
    issn: clean(r.issn),

    publisher: clean(r.publisher),
    publisher_alt: clean(r.publisher_1),

    country: clean(r.country),
    region: clean(r.region),

    categories: clean(r.categories),
    areas: clean(r.areas),

    rank: parseNum(r.rank),

    sjr: parseNum(r.sjr),
    sjr_best_quartile: clean(r.sjr_best_quartile),

    h_index: parseNum(r.h_index),

    total_docs_2024: parseNum(r.total_docs_2024),
    total_docs_3years: parseNum(r.total_docs_3years),

    total_refs: parseNum(r.total_refs),
    total_cites_3years: parseNum(r.total_citations_3years),

    citable_docs_3years: parseNum(r.citable_docs_3years),

    cites_per_doc_2years: parseNum(r.citations_doc_2years),
    ref_per_doc: parseNum(r.ref_doc),

    female_percent: parseNum(r.female),

    overton: parseNum(r.overton),
    sdg: parseNum(r.sdg),

    coverage: clean(r.coverage),

    open_access: clean(r.open_access),
    open_access_diamond: clean(r.open_access_diamond),

    // 🔥 NEW FIELD (tích hợp thay vì script riêng)
    scimago_link: buildScimagoLink(r.sourceid),

    text: buildText(r),
    raw: r,

    updatedAt: new Date()
  };
}

// ================= MAIN =================
async function run() {
  console.log("🚀 JOURNAL UPSERT (PRODUCTION + LINK)");

  await client.connect();
  const col = client.db(DB).collection("journal");

  let batch = [];
  let total = 0;
  let inserted = 0;
  let updated = 0;
  let first = true;

  const stream = fs.createReadStream(FILE_PATH).pipe(
    csv({
      separator: ";",
      mapHeaders: ({ header }) => normalizeHeader(header),
    })
  );

  for await (const row of stream) {
    if (first) {
      console.log("🔍 HEADER:", Object.keys(row));
      first = false;
    }

    const data = mapRow(row);

    batch.push({
      updateOne: {
        filter: { u_key: data.u_key },
        update: {
          $set: data,
          $setOnInsert: { createdAt: new Date() },
          $unset: {
            total_docs_3_years: "",
            total_citations_3_years: "",
          }
        },
        upsert: true
      }
    });

    if (batch.length >= BATCH_SIZE) {
      const res = await col.bulkWrite(batch);

      inserted += res.upsertedCount;
      updated += res.modifiedCount;
      total += batch.length;

      console.log("⚡ batch:", {
        processed: total,
        inserted,
        updated
      });

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