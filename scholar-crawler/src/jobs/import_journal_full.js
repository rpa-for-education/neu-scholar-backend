// import_journal_full.js
import fs from "fs";
import csv from "csv-parser";
import crypto from "crypto";
import { getDb } from "../services/mongo.js";

const FILE_PATH = "../data/data_scimagojr_2025.csv";
const BATCH_SIZE = 500;

const genKey = v =>
  crypto.createHash("md5").update(String(v)).digest("hex");

const parseNum = v => {
  if (!v) return null;
  const n = Number(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
};

async function run() {
  const db = await getDb();
  const col = db.collection("journal");

  let batch = [];

  const stream = fs.createReadStream(FILE_PATH).pipe(
    csv({ separator: ";" })
  );

  for await (const row of stream) {
    const u_key = genKey(row.sourceid || row.title);

    batch.push({
      updateOne: {
        filter: { u_key },
        update: {
          $set: {
            u_key,
            title: row.title,
            publisher: row.publisher,
            country: row.country,
            sjr: parseNum(row.sjr),
            updatedAt: new Date()
          },
          $setOnInsert: { createdAt: new Date() }
        },
        upsert: true
      }
    });

    if (batch.length >= BATCH_SIZE) {
      await col.bulkWrite(batch);
      batch = [];
    }
  }

  if (batch.length) await col.bulkWrite(batch);

  console.log("🎯 JOURNAL DONE");
}

run();