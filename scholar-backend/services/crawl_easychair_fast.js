// crawl_easychair_fast.js
import axios from "axios";
import * as cheerio from "cheerio";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const client = new MongoClient(process.env.MONGODB_URI);
const DB_NAME = process.env.DB_NAME || "fitneu";
const COLLECTION = "conference";

const URL = "https://easychair.org/cfp2/";

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

  let bulk = [];

  rows.each((_, row) => {
    const cols = $(row).find("td");
    if (cols.length < 6) return;

    const acronym = $(cols[0]).text().trim();
    const name = $(cols[1]).text().trim();
    const location = $(cols[2]).text().trim();
    const deadline = $(cols[3]).text().trim();
    const start_date = $(cols[4]).text().trim();

    let link = $(cols[0]).find("a").attr("href");
    if (link && !link.startsWith("http")) {
      link = "https://easychair.org" + link;
    }

    // 🔥 incremental update
    bulk.push({
        updateOne: {
            filter: {
            acronym,
            start_date
            },
            update: [
            {
                $set: {
                name,
                location,
                url: link,
                deadline,

                // 🔥 detect thay đổi
                status: {
                    $cond: [
                    {
                        $or: [
                        { $ne: ["$name", name] },
                        { $ne: ["$location", location] },
                        { $ne: ["$deadline", deadline] },
                        { $ne: ["$url", link] }
                        ]
                    },
                    "pending",
                    "$status"
                    ]
                },

                updated_time: new Date()
                }
            }
            ],
            upsert: true
        }
    });
  });

  const res = await col.bulkWrite(bulk, { ordered: false });

  console.log(
    `🆕 Inserted: ${res.upsertedCount || 0} | 🔄 Updated: ${
      res.modifiedCount || 0
    }`
  );

  await removeDuplicates(col);

  await col.createIndex(
    { acronym: 1, start_date: 1 },
    { unique: true }
  );

  console.log("✅ Index ready");
  console.log("🎯 Phase 1 DONE");

  await client.close();
}

run();