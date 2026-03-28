import axios from "axios";
import * as cheerio from "cheerio";
import PQueue from "p-queue";
import { chromium } from "playwright";
import { getDb } from "../services/mongo.js";

const CONCURRENCY = 2;
const LIMIT = 200;
const TIMEOUT = 15000;

let browser;

// ================= EXTRACT =================
function extractDeadline(text) {
  const match = text.match(/([A-Za-z]+ \d{1,2}, \d{4})/);
  if (!match) return null;

  const d = new Date(match[1]);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

// ================= FETCH =================
async function fetch(url) {
  try {
    const res = await axios.get(url, { timeout: TIMEOUT });
    if (res.data && res.data.length > 500) return res.data;
  } catch {}

  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }

  const page = await browser.newPage();
  try {
    await page.goto(url, { timeout: 30000 });
    return await page.content();
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

// ================= MAIN =================
async function run() {
  const db = await getDb();
  const col = db.collection("conference");

  console.log("🚀 Enrich incremental...");

  // 🔥 CHỈ lấy data cần enrich
  const docs = await col
    .find({ status: "pending" })
    .limit(LIMIT)
    .toArray();

  console.log(`📊 Need enrich: ${docs.length}`);

  if (!docs.length) {
    console.log("✅ Nothing to enrich");
    process.exit(0);
  }

  const queue = new PQueue({ concurrency: CONCURRENCY });

  for (const doc of docs) {
    queue.add(async () => {
      const html = await fetch(doc.url);
      if (!html) return;

      const $ = cheerio.load(html);
      const text = $("body").text();

      const deadline = extractDeadline(text);

      await col.updateOne(
        { _id: doc._id },
        {
          $set: {
            deadline,
            enrichedAt: new Date(),
            status: "done"
          }
        }
      );

      console.log("✅ enriched:", doc.acronym);
    });
  }

  await queue.onIdle();

  console.log("🎯 ENRICH DONE");

  if (browser) await browser.close();
  process.exit(0);
}

run();