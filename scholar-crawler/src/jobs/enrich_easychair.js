// enrich_easychair.js

import axios from "axios";
import * as cheerio from "cheerio";
import PQueue from "p-queue";
import { chromium } from "playwright";
import { getDb, closeDb } from "../services/mongo.js";

/* ================= CONFIG ================= */
const CONCURRENCY = 2;
const TIMEOUT = 20000;
const MAX_CFP_LENGTH = 30000;

/* ================= CFP ================= */
function extractCFP($) {
  try {
    $("script, style, nav, footer, header").remove();

    const text = $("body")
      .text()
      .replace(/EasyChair.*?Log in/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (text.length < 200) return null;

    return text.slice(0, MAX_CFP_LENGTH);
  } catch {
    return null;
  }
}

/* ================= DATE ================= */
function extractDeadline(text) {
  try {
    const match = text.match(
      /([A-Za-z]+ \d{1,2}, \d{4})/
    );

    if (!match) return null;

    const d = new Date(match[1]);

    return isNaN(d)
      ? null
      : d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

/* ================= FETCH ================= */
async function fetchAxios(url) {
  try {
    const res = await axios.get(url, {
      timeout: TIMEOUT,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137 Safari/537.36",
        Accept: "text/html"
      },
      validateStatus: () => true
    });

    if (
      !res.data ||
      res.status >= 400 ||
      String(res.data).length < 1000
    ) {
      throw new Error("Bad HTML");
    }

    return res.data;
  } catch {
    return null;
  }
}

let browser;

async function fetchPlaywright(url) {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox"]
    });
  }

  const page = await browser.newPage();

  try {
    await page.goto(url, {
      timeout: 30000,
      waitUntil: "domcontentloaded"
    });

    return await page.content();
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

async function smartFetch(url) {
  let html = await fetchAxios(url);

  if (html) {
    return {
      html,
      source: "axios"
    };
  }

  console.log("⚠️ Playwright fallback:", url);

  html = await fetchPlaywright(url);

  if (html) {
    return {
      html,
      source: "playwright"
    };
  }

  return {
    html: null,
    source: "fail"
  };
}

/* ================= MAIN ================= */
async function run() {
  console.log("🤖 Enrich incremental...");

  const db = await getDb();
  const col = db.collection("conference");

  const totalPending =
    await col.countDocuments({
      $or: [
        { status: { $exists: false } },
        { status: { $ne: "done" } }
      ]
    });

  console.log(
    `📊 Pending conferences: ${totalPending}`
  );

  const cursor = col
    .find({
      $or: [
        { status: { $exists: false } },
        { status: { $ne: "done" } }
      ]
    })
    .limit(5000);

  const queue = new PQueue({
    concurrency: CONCURRENCY
  });

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for await (const doc of cursor) {
    queue.add(async () => {
      try {
        if (!doc.url) {
          skipped++;
          return;
        }

        const { html, source } =
          await smartFetch(doc.url);

        if (!html) {
          await col.updateOne(
            { _id: doc._id },
            {
              $set: {
                status: "failed",
                updated_time: new Date()
              }
            }
          );

          failed++;
          return;
        }

        const $ = cheerio.load(html);
        const bodyText = $("body").text();

        const cfp_text = extractCFP($);
        const newDeadline =
          extractDeadline(bodyText);

        const update = {
          crawl_source: source,
          updated_time: new Date(),
          status: "done"
        };

        let needUpdate = false;

        if (cfp_text && !doc.cfp_text) {
          update.cfp_text = cfp_text;
          needUpdate = true;
        }

        if (newDeadline && !doc.deadline) {
          update.deadline = newDeadline;
          needUpdate = true;
        }

        if (
          newDeadline &&
          doc.deadline &&
          doc.deadline !== newDeadline
        ) {
          console.log(
            `⚠️ Deadline mismatch: ${doc.acronym}`
          );
        }

        await col.updateOne(
          { _id: doc._id },
          {
            $set: update
          }
        );

        if (needUpdate) {
          updated++;

          console.log(
            `✅ ${updated} - ${doc.acronym}`
          );
        } else {
          skipped++;
        }
      } catch (err) {
        failed++;

        console.error(
          `❌ ${doc.acronym || doc.url}`
        );

        console.error(err.message);
      }
    });
  }

  await queue.onIdle();

  if (browser) {
    await browser.close();
  }

  console.log(`
🔄 Updated: ${updated}
⏭️ Skipped: ${skipped}
❌ Failed: ${failed}
🎯 ENRICH DONE
`);
}

run()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async err => {
    console.error("❌ ENRICH ERROR");
    console.error(err);

    await closeDb();

    process.exit(1);
  });