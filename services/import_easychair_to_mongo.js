import { chromium } from "playwright";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

/* CONFIG */
const client = new MongoClient(process.env.MONGODB_URI);
const DB_NAME = process.env.DB_NAME || "fitneu";
const COLLECTION = "conference";

const BATCH_SIZE = 200;
const CONCURRENCY = 5; // tăng tốc
const RETRY = 2;

/* URL */
const URLS = [
  "https://easychair.org/cfp2/",
  "https://easychair.org/cfp2/random.cgi",
  "https://easychair.org/cfp2/country.cgi?cc=us",
  "https://easychair.org/cfp2/country.cgi?cc=vn",
];

const limit = pLimit(CONCURRENCY);

let browser;
let context;

/* INIT */
async function initBrowser() {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
}

/* FETCH (REUSE PAGE) */
async function fetchHtml(url, attempt = 1) {
  const page = await context.newPage();

  try {
    await page.goto(url, {
      timeout: 20000,
      waitUntil: "domcontentloaded",
    });

    const html = await page.content();
    await page.close();
    return html;
  } catch (err) {
    await page.close();

    if (attempt < RETRY) {
      await new Promise(r => setTimeout(r, 1000));
      return fetchHtml(url, attempt + 1);
    }

    console.log("❌ Skip:", url);
    return "";
  }
}

/* PARSE */
function parseLocation(location) {
  if (!location) return {};
  const parts = location.split(",").map(s => s.trim());

  return {
    city: parts[0],
    country: parts[parts.length - 1],
  };
}

/* SCRAPE PAGE */
async function scrapeUrl(url) {
  console.log(`🚀 ${url}`);

  const html = await fetchHtml(url);
  if (!html) return [];

  const $ = cheerio.load(html);
  const rows = $("table tbody tr");

  const data = [];

  rows.each((_, row) => {
    const cols = $(row).find("td");
    if (cols.length < 6) return;

    const acronym = $(cols[0]).text().trim();
    const name = $(cols[1]).text().trim();
    const location = $(cols[2]).text().trim();

    const deadline = $(cols[3]).text().trim();
    const start_date = $(cols[4]).text().trim();

    const topics = $(cols[5]).text();

    let link = $(cols[0]).find("a").attr("href");
    if (link && !link.startsWith("http")) {
      link = "https://easychair.org" + link;
    }

    const loc = parseLocation(location);

    data.push({
      acronym,
      name,
      location,
      city: loc.city,
      country: loc.country,

      deadline,
      start_date,
      topics,
      url: link,

      updated_time: new Date().toISOString(),
    });
  });

  return data;
}

/* MAIN */
async function run() {
  await client.connect();
  console.log("✅ MongoDB connected");

  await initBrowser();
  console.log("🌐 Browser ready");

  const db = client.db(DB_NAME);
  const col = db.collection(COLLECTION);

  console.log("\n🚀 Start crawling...\n");

  const results = await Promise.all(
    URLS.map(url => limit(() => scrapeUrl(url)))
  );

  const allData = results.flat();

  console.log(`📦 Total: ${allData.length}`);

  let bulk = [];
  let count = 0;

  for (const doc of allData) {
    bulk.push({
      updateOne: {
        filter: {
          acronym: doc.acronym,
          start_date: doc.start_date,
        },
        update: {
          $set: doc,
          $setOnInsert: {
            created_time: new Date().toISOString(),
          },
        },
        upsert: true,
      },
    });

    count++;

    if (bulk.length >= BATCH_SIZE) {
      await col.bulkWrite(bulk, { ordered: false });
      bulk = [];

      console.log(`⏳ ${count}/${allData.length}`);
    }
  }

  if (bulk.length) {
    await col.bulkWrite(bulk);
  }

  console.log("\n🎯 DONE");

  await browser.close();
  await client.close();
}

run();