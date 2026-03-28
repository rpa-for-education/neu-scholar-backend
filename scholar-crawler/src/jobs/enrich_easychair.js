import axios from "axios";
import * as cheerio from "cheerio";
import PQueue from "p-queue";
import { chromium } from "playwright";
import { getDb } from "../services/mongo.js";

/* ================= CONFIG ================= */
const CONCURRENCY = 2;
const TIMEOUT = 20000;
const MAX_CFP_LENGTH = 30000;

/* ================= CFP ================= */
function extractCFP($) {
  try {
    $("script, style, nav, footer, header").remove();

    let text = $("body").text()
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
    const match = text.match(/([A-Za-z]+ \d{1,2}, \d{4})/);
    if (!match) return null;

    const d = new Date(match[1]);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
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
        "User-Agent": "Mozilla/5.0 Chrome/120",
        "Accept": "text/html"
      },
      validateStatus: () => true
    });

    if (!res.data || res.status >= 400 || res.data.length < 1000) {
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
    await page.goto(url, { timeout: 30000 });
    const html = await page.content();
    await page.close();
    return html;
  } catch {
    await page.close();
    return null;
  }
}

async function smartFetch(url) {
  let html = await fetchAxios(url);
  if (html) return { html, source: "axios" };

  console.log("⚠️ Playwright fallback:", url);

  html = await fetchPlaywright(url);
  if (html) return { html, source: "playwright" };

  return { html: null, source: "fail" };
}

/* ================= MAIN ================= */
async function run() {
  console.log("🤖 Enrich incremental...");

  const db = await getDb();
  const col = db.collection("conference");

  const cursor = col.find({
    $or: [
      { status: { $exists: false } },
      { status: { $ne: "done" } }
    ]
  }).limit(5000);

  const queue = new PQueue({ concurrency: CONCURRENCY });

  let updated = 0;
  let skipped = 0;

  for await (const doc of cursor) {
    queue.add(async () => {
      try {
        if (!doc.url) return;

        const { html, source } = await smartFetch(doc.url);
        if (!html) return;

        const $ = cheerio.load(html);
        const bodyText = $("body").text();

        const cfp_text = extractCFP($);
        const newDeadline = extractDeadline(bodyText);

        const update = {
          crawl_source: source,
          updated_time: new Date()
        };

        let needUpdate = false;

        // ===== CFP =====
        if (cfp_text && !doc.cfp_text) {
          update.cfp_text = cfp_text;
          needUpdate = true;
        }

        // ===== DEADLINE (QUAN TRỌNG) =====
        if (newDeadline) {
          if (!doc.deadline) {
            update.deadline = newDeadline;
            needUpdate = true;
          } else if (doc.deadline !== newDeadline) {
            // nếu khác → có thể log nhưng KHÔNG overwrite bừa
            console.log("⚠️ Deadline mismatch:", doc.acronym);
          }
        }

        // ===== STATUS =====
        if (needUpdate) {
          update.status = "done";

          await col.updateOne(
            { _id: doc._id },
            { $set: update }
          );

          updated++;
          console.log(`✅ ${updated} - ${doc.acronym}`);
        } else {
          skipped++;
        }
      } catch (err) {
        console.log("❌", doc.url);
      }
    });
  }

  await queue.onIdle();

  if (browser) await browser.close();

  console.log(`
🔄 Updated: ${updated}
⏭️ Skipped: ${skipped}
🎯 ENRICH DONE
  `);

  process.exit(0);
}

run();