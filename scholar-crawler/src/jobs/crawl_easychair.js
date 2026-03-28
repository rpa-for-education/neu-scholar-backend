import axios from "axios";
import * as cheerio from "cheerio";
import { MongoClient } from "mongodb";
import { getDb } from "../services/mongo.js";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const client = new MongoClient(process.env.MONGODB_URI);
const DB_NAME = process.env.DB_NAME || "fitneu";
const COLLECTION = "conference";

const URL = "https://easychair.org/cfp2/";

const hash = (obj) =>
  crypto.createHash("md5").update(JSON.stringify(obj)).digest("hex");

/* ================= REMOVE DUPLICATE ================= */
async function removeDuplicates(col) {
  console.log("🧹 Removing duplicates...");

  const cursor = col.aggregate([
    { $sort: { updated_time: -1 } },
    {
      $group: {
        _id: {
          acronym: "$acronym",
          start_date: "$start_date",
        },
        ids: { $push: "$_id" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  let removed = 0;

  for await (const doc of cursor) {
    doc.ids.shift();
    const res = await col.deleteMany({ _id: { $in: doc.ids } });
    removed += res.deletedCount;
  }

  console.log(`🗑️ Removed: ${removed}`);
}

/* ================= MAIN ================= */
async function run() {
  await client.connect();
  console.log("✅ MongoDB connected");

  const db = client.db(DB_NAME);
  const col = db.collection(COLLECTION);

  console.log("🚀 Crawling...");

  const { data } = await axios.get(URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36",
    },
  });

  const $ = cheerio.load(data);
  const rows = $("table tbody tr");

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows.toArray()) {
    const cols = $(row).find("td");
    if (cols.length < 6) continue;

    const acronym = $(cols[0]).text().trim();
    const name = $(cols[1]).text().trim();
    const location = $(cols[2]).text().trim();
    const deadline = $(cols[3]).text().trim();
    const start_date = $(cols[4]).text().trim();

    let link = $(cols[0]).find("a").attr("href");
    if (link && !link.startsWith("http")) {
      link = "https://easychair.org" + link;
    }

    const newDoc = {
      acronym,
      name,
      location,
      deadline,
      start_date,
      url: link,
    };

    const newHash = hash(newDoc);

    const existing = await col.findOne({
      acronym,
      start_date,
    });

    // INSERT
    if (!existing) {
      await col.insertOne({
        ...newDoc,
        hash: newHash,
        status: "pending",
        updated_time: new Date(),
      });
      inserted++;
      continue;
    }

    // SKIP
    if (existing.hash === newHash) {
      skipped++;
      continue;
    }

    // UPDATE (KHÔNG overwrite field khác)
    await col.updateOne(
      { _id: existing._id },
      {
        $set: {
          name,
          location,
          deadline,
          url: link,
          hash: newHash,
          status: "pending",
          updated_time: new Date(),
        },
      }
    );

    updated++;
  }

  console.log(`
🆕 Inserted: ${inserted}
🔄 Updated: ${updated}
⏭️ Skipped: ${skipped}
  `);

  await removeDuplicates(col);

  await col.createIndex(
    { acronym: 1, start_date: 1 },
    { unique: true }
  );

  console.log("✅ Index ready");
  console.log("🎯 DONE");

  await client.close();
}

run();