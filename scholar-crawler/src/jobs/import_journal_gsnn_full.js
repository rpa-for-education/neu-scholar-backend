import fs from "fs";
import readline from "readline";
import crypto from "crypto";
import { getDb } from "../services/mongo.js";

const FILE_PATH = "./data/data_gsnnvn.csv";

const genKey = v =>
  crypto.createHash("md5").update(String(v)).digest("hex");

async function run() {
  const db = await getDb();
  const col = db.collection("journal");

  const rl = readline.createInterface({
    input: fs.createReadStream(FILE_PATH)
  });

  let headers;

  for await (const line of rl) {
    if (!headers) {
      headers = line.split(",");
      continue;
    }

    const values = line.split(",");
    let row = {};
    headers.forEach((h, i) => (row[h] = values[i]));

    const u_key = genKey(row.issn || row.title);

    await col.updateOne(
      { u_key },
      {
        $set: {
          title: row.title,
          issn: row.issn,
          updatedAt: new Date()
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );
  }

  console.log("🎯 GSNN DONE");
}

run();