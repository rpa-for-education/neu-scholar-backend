import axios from "axios";
import * as cheerio from "cheerio";
import { getDb } from "../services/mongo.js";

const URL = "https://easychair.org/cfp2/";

async function run() {
  const db = await getDb();
  const col = db.collection("conference");

  console.log("🚀 Crawling EasyChair...");

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

    bulk.push({
      updateOne: {
        filter: { acronym, start_date },
        update: [
          {
            $set: {
              name,
              location,
              deadline,
              url: link,

              // 🔥 detect thay đổi → set pending
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

  if (bulk.length) {
    const res = await col.bulkWrite(bulk, { ordered: false });

    console.log(
      `🆕 Inserted: ${res.upsertedCount || 0} | 🔄 Updated: ${
        res.modifiedCount || 0
      }`
    );
  }

  // 🔥 index giúp enrich nhanh
  await col.createIndex({ status: 1 });
  await col.createIndex({ acronym: 1, start_date: 1 }, { unique: true });

  console.log("✅ Crawl DONE");
}

run();