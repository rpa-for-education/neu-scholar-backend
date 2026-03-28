import axios from "axios";
import * as cheerio from "cheerio";
import crypto from "crypto";
import { getDb } from "../services/mongo.js";

const URL = "https://easychair.org/cfp2/";

const genKey = (v) =>
  crypto.createHash("md5").update(String(v)).digest("hex");

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

    const _key = genKey(acronym + "_" + start_date);

    bulk.push({
      updateOne: {
        filter: { _key }, // 🔥 chỉ dùng _key
        update: [
          {
            $set: {
              _key,
              acronym,
              start_date,

              name,
              location,
              deadline,
              url: link,

              // 🔥 CHỈ update nếu có thay đổi
              changed: {
                $or: [
                  { $ne: ["$name", name] },
                  { $ne: ["$location", location] },
                  { $ne: ["$deadline", deadline] },
                  { $ne: ["$url", link] }
                ]
              }
            }
          },
          {
            $set: {
              status: {
                $cond: [
                  "$changed",
                  "pending",
                  "$status"
                ]
              },
              updated_time: {
                $cond: [
                  "$changed",
                  new Date(),
                  "$updated_time"
                ]
              }
            }
          },
          {
            $unset: "changed"
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

  // 🔥 index chuẩn
  await col.createIndex({ _key: 1 }, { unique: true });
  await col.createIndex({ status: 1 });

  console.log("✅ Crawl DONE");
}

run();