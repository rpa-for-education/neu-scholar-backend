import axios from "axios";
import * as cheerio from "cheerio";
import PQueue from "p-queue";
import fs from "fs/promises";
import path from "path";
import { getDb } from "../db/mongo.js";

/* ================= CONFIG ================= */
const CONCURRENCY = 2;
const TIMEOUT = 20000;
const MAX_CFP_LENGTH = 30000;

/* ================= GEO DATA ================= */
const CITY_FILE = path.resolve("scripts/cities15000.txt");
const CONTINENT_FILE = path.resolve("scripts/country_continent.json");

let geoMap = new Map();
let continentMap = {};

async function initGeo() {
  const geoText = await fs.readFile(CITY_FILE, "utf8");
  const lines = geoText.split("\n");

  for (const line of lines) {
    const cols = line.split("\t");
    const city = cols[1];
    const countryCode = cols[8];

    if (city && countryCode) {
      geoMap.set(city.toLowerCase(), countryCode);
    }
  }

  continentMap = JSON.parse(
    await fs.readFile(CONTINENT_FILE, "utf8")
  );

  console.log("🌍 Geo loaded:", geoMap.size);
}

/* ================= CLEAN ================= */
function cleanText(text) {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/EasyChair.*?Log in/i, "")
    .replace(/User Guide.*?Watchlist/i, "")
    .trim();
}

/* ================= SAFE CUT ================= */
function safeCut(text) {
  if (text.length <= MAX_CFP_LENGTH) return text;

  let cut = text.slice(0, MAX_CFP_LENGTH);
  const lastDot = cut.lastIndexOf(".");

  if (lastDot > 1000) {
    cut = cut.slice(0, lastDot + 1);
  }

  return cut;
}

/* ================= TRIM CFP ================= */
function trimCFP(text) {
  const stopKeywords = [
    "committee",
    "editor",
    "journal",
    "registration fee",
    "abstracting/indexing",
  ];

  let lower = text.toLowerCase();
  let cutIndex = text.length;

  for (const key of stopKeywords) {
    const idx = lower.indexOf(key);
    if (idx !== -1 && idx < cutIndex) {
      cutIndex = idx;
    }
  }

  return text.slice(0, cutIndex).trim();
}

/* ================= DATE ================= */
function parseDateToISO(text) {
  const months = {
    january: "01", february: "02", march: "03",
    april: "04", may: "05", june: "06",
    july: "07", august: "08", september: "09",
    october: "10", november: "11", december: "12"
  };

  const match = text.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!match) return null;

  const month = months[match[1].toLowerCase()];
  const day = match[2].padStart(2, "0");
  const year = match[3];

  return month ? `${year}-${month}-${day}` : null;
}

function extractDeadline(text) {
  const match = text.match(
    /(deadline|due|submission).*?([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i
  );

  return match ? parseDateToISO(match[2]) : null;
}

/* ================= GEO ================= */
function normalizeCity(s) {
  return s
    .replace(/\s+/g, " ")
    .replace(/,\s*[^,]+$/, "")
    .replace(/university|institute|college/gi, "")
    .trim();
}

function extractCityCandidate(text) {
  const patterns = [
    /held at ([^,]+),/i,
    /in ([A-Za-z'’\- ]+),\s*[A-Za-z ]+,\s*(?:from|on)/i,
    /takes place in ([^,]+),/i,
  ];

  for (const regex of patterns) {
    const match = text.match(regex);
    if (match) return match[1];
  }

  return null;
}

function extractGeo(text) {
  const rawCity = extractCityCandidate(text);
  if (!rawCity) return {};

  const city = normalizeCity(rawCity);
  const code = geoMap.get(city.toLowerCase());

  return {
    city,
    country_code: code || null,
    continent: code ? continentMap[code] : null,
  };
}

/* ================= LINK ================= */
function cleanLink(link) {
  const match = link?.match(/https?:\/\/[^\s"]+/);
  if (!match) return null;

  const confMatch = match[0].match(/conf=[a-zA-Z0-9_-]+/);

  return confMatch
    ? `https://easychair.org/conferences/?${confMatch[0]}`
    : match[0];
}

/* ================= TOPICS ================= */
function extractTopics(text) {
  const match = text.match(/theme:(.*?)(\.|\n)/i);

  if (!match) return [];

  return match[1]
    .split(/,|—|-/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/* ================= RANK ================= */
function rankConference(text) {
  let score = 0;

  if (/ieee/i.test(text)) score += 3;
  if (/springer/i.test(text)) score += 3;
  if (/scopus/i.test(text)) score += 2;
  if (/wos|web of science/i.test(text)) score += 2;

  if (score >= 7) return "A*";
  if (score >= 5) return "A";
  if (score >= 3) return "B";
  return "C";
}

/* ================= PARSER ================= */
function parseEasyChair(html) {
  const $ = cheerio.load(html);

  $("script, style, nav, footer, header").remove();

  const bodyText = cleanText($("body").text());

  let cfp_text = "";

  $("p, h1, h2, h3").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 80) cfp_text += t + "\n";
  });

  cfp_text = safeCut(trimCFP(cleanText(cfp_text)));

  let submission_link = null;

  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!submission_link && href?.includes("conf=")) {
      submission_link = cleanLink(href);
    }
  });

  const deadline = extractDeadline(bodyText);
  const topics = extractTopics(bodyText);
  const geo = extractGeo(bodyText);
  const rank = rankConference(bodyText);

  return {
    cfp_text,
    submission_link,
    deadline,
    topics,
    ...geo,
    rank,
  };
}

/* ================= MAIN ================= */
async function run() {
  console.log("🚀 AI Enrich FINAL (ALL-IN-ONE)...");

  await initGeo();

  const db = await getDb();
  const col = db.collection("conference");

  const docs = await col
    .find({
      $or: [
        { cfp_text: { $exists: false } },
        { cfp_text: "" },
      ],
    })
    .limit(5000)
    .toArray();

  const queue = new PQueue({ concurrency: CONCURRENCY });

  let count = 0;

  for (const doc of docs) {
    queue.add(async () => {
      try {
        console.log("🌐 Fetch:", doc.url);

        const res = await axios.get(doc.url, {
          timeout: TIMEOUT,
        });

        const html = res.data;

        const data = parseEasyChair(html);

        await col.updateOne(
          { _id: doc._id },
          {
            $set: {
              ...data,
              status: "done",
              updated_time: new Date().toISOString(),
            },
          }
        );

        count++;
        console.log(`✅ Done: ${count}`);
      } catch (err) {
        console.log("❌ Failed:", doc.url);
      }
    });
  }

  await queue.onIdle();

  console.log("🎯 DONE CFP ENRICH");
  process.exit(0);
}

run();