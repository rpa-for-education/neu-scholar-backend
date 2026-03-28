import fs from "fs";
import csv from "csv-parser";
import { getDb } from "../services/mongo.js";

async function run() {
  const db = await getDb();
  const col = db.collection("fund");

  const stream = fs.createReadStream("./data/data_other_funds.csv").pipe(csv());

  for await (const row of stream) {
    await col.updateOne(
      { url: row.url },
      {
        $set: {
          title: row.opportunity_title,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
  }

  console.log("🎯 OTHER FUND DONE");
}

run();