// enrich_easychair_ai.js
import axios from "axios";
import * as cheerio from "cheerio";
import PQueue from "p-queue";
import fs from "fs/promises";
import { chromium } from "playwright";
import { getDb } from "../db/mongo.js";

/* ================= CONFIG ================= */
const CONCURRENCY = 2;
const TIMEOUT = 20000;
const MAX_CFP_LENGTH = 30000;

/* ================= COUNTRY MAP ================= */
const COUNTRY_NAME_TO_ISO = {
  "italy": "IT","france": "FR","china": "CN","vietnam": "VN",
  "united states": "US","usa": "US","uk": "GB","united kingdom": "GB",
  "germany": "DE","japan": "JP","spain": "ES","canada": "CA",
  "peru": "PE","qatar": "QA","india": "IN","netherlands": "NL",
  "switzerland": "CH","australia": "AU","singapore": "SG"
};

/* ================= PATH ================= */
const COUNTRY_FILE = new URL("./scripts/countryInfo.txt", import.meta.url);
const CITY_FILE = new URL("./scripts/cities15000.txt", import.meta.url);

/* ================= GLOBAL ================= */
let geoMap = new Map();
let ISO_TO_COUNTRY = {};
let ISO_TO_CONTINENT = {};
let browser;

/* ================= HELPER ================= */
function clean(s = "") {
  return s.toLowerCase().replace(/[()]/g, "").trim();
}

function titleCase(s = "") {
  return s.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

async function safeRead(fileUrl) {
  try {
    return await fs.readFile(fileUrl, "utf8");
  } catch {
    console.error("❌ Missing file:", fileUrl.href);
    return "";
  }
}

/* ================= GEO ================= */
async function initGeo() {
  console.log("🌍 Loading Geo...");

  const countryText = await safeRead(COUNTRY_FILE);

  countryText.split("\n").forEach(line => {
    if (!line || line.startsWith("#")) return;

    const cols = line.split("\t");
    const iso = cols[0];
    const name = cols[4];
    const continent = cols[8];

    if (!iso) return;

    ISO_TO_COUNTRY[iso] = name;

    ISO_TO_CONTINENT[iso] = {
      AF: "Africa", AS: "Asia", EU: "Europe",
      NA: "North America", SA: "South America", OC: "Oceania"
    }[continent] || null;
  });

  const geoText = await safeRead(CITY_FILE);

  geoText.split("\n").forEach(line => {
    const cols = line.split("\t");
    if (!cols || cols.length < 9) return;

    const city = clean(cols[1]);
    const countryCode = cols[8];

    if (city && countryCode) {
      geoMap.set(city, {
        city: cols[1],
        country_code: countryCode
      });
    }
  });

  console.log(`✅ Geo loaded: ${geoMap.size}`);
}

/* ================= LOCATION ================= */
function extractFromLocation(location) {
  if (!location) return {};

  const parts = location.split(",").map(s => s.trim());
  const cityKey = clean(parts[0]);

  if (geoMap.has(cityKey)) return geoMap.get(cityKey);

  for (let i = parts.length - 1; i >= 1; i--) {
    const key = clean(parts[i]);
    if (COUNTRY_NAME_TO_ISO[key]) {
      return {
        city: titleCase(parts[0]),
        country_code: COUNTRY_NAME_TO_ISO[key]
      };
    }
  }

  return {};
}

/* ================= CFP ================= */
function extractCFP($) {
  try {
    $("script, style, nav, footer, header").remove();

    let text = $("body").text();

    text = text
      .replace(/EasyChair.*?Log in/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    const parts = text.split(/(?<=\.)\s+/);

    const good = parts.filter(p =>
      p.length > 80 && !/login|easychair/i.test(p)
    );

    let cfp = good.join("\n");

    if (cfp.length > MAX_CFP_LENGTH) cfp = cfp.slice(0, MAX_CFP_LENGTH);
    if (cfp.length < 200) return null;

    return cfp.trim();
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
    if (isNaN(d)) return null;

    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

/* ================= PARSER ================= */
async function parseEasyChair(doc, html) {
  try {
    const $ = cheerio.load(html);
    const bodyText = $("body").text();

    return {
      cfp_text: extractCFP($),
      deadline: extractDeadline(bodyText),
      ...extractFromLocation(doc.location || "")
    };
  } catch (err) {
    throw new Error("Parse crash: " + err.message);
  }
}

/* ================= AXIOS ================= */
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

/* ================= PLAYWRIGHT ================= */
async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  }
  return browser;
}

async function fetchPlaywright(url) {
  const browser = await getBrowser();
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

/* ================= SMART FETCH ================= */
async function smartFetch(url) {
  let html = await fetchAxios(url);
  if (html) return { html, source: "axios" };

  console.log("⚠️ Fallback Playwright:", url);

  html = await fetchPlaywright(url);
  if (html) return { html, source: "playwright" };

  return { html: null, source: "fail" };
}

/* ================= MAIN ================= */
async function run() {
  console.log("🚀 ENRICH FINAL STABLE");

  await initGeo();

  const db = await getDb();
  const col = db.collection("conference");

  const docs = await col.find({}).limit(5000).toArray();

  const queue = new PQueue({ concurrency: CONCURRENCY });

  let done = 0;

  for (const doc of docs) {
    queue.add(async () => {
      try {
        const { html, source } = await smartFetch(doc.url);

        if (!html || html.length < 500) {
          console.log("❌ HTML yếu:", doc.url);
          return;
        }

        let data = {};

        try {
          data = await parseEasyChair(doc, html);
        } catch (err) {
          console.log("⚠️ Parse fail:", doc.url);
          console.log("👉", err.message);
          data = {};
        }

        await col.updateOne(
          { _id: doc._id },
          {
            $set: {
              ...data,
              crawl_source: source,
              status: Object.keys(data).length ? "done" : "partial",
              updated_time: new Date().toISOString()
            }
          }
        );

        done++;
        console.log(`✅ ${done} (${source})`);
        console.log(`   📌 ${doc.title || "No title"}`);
        console.log(`   🔗 ${doc.url}`);
        console.log(`   📅 ${data.deadline || "No deadline"}`);
        console.log(`   🌍 ${data.city || ""} ${data.country_code || ""}`);
      } catch (err) {
        console.log("❌ ERROR:", doc.url);
        console.log("👉", err.message);
      }
    });
  }

  await queue.onIdle();

  console.log("🎯 DONE");
  process.exit(0);
}

run();