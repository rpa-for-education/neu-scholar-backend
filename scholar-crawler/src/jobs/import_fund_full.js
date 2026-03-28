import fs from "fs";
import csv from "csv-parser";
import crypto from "crypto";
import { getDb } from "../services/mongo.js";

const FILE_PATH = "./data/grants-search-202603261431.csv";

const genKey = v =>
  crypto.createHash("md5").update(String(v)).digest("hex");

async function run() {
  const db = await getDb();
  const col = db.collection("fund");

  let batch = [];

  const stream = fs.createReadStream(FILE_PATH).pipe(csv());

  for await (const row of stream) {
    const u_key = genKey(row.opportunity_id || row.url);

    batch.push({
      updateOne: {
        filter: { u_key },
        update: {
          $set: {
            title: row.opportunity_title,
            agency: row.agency_name,
            updatedAt: new Date()
          },
          $setOnInsert: { createdAt: new Date() }
        },
        upsert: true
      }
    });

    if (batch.length >= 500) {
      await col.bulkWrite(batch);
      batch = [];
    }
  }

  if (batch.length) await col.bulkWrite(batch);

  console.log("🎯 FUND DONE");
}

run();