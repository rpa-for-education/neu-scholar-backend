import axios from "axios";
import * as cheerio from "cheerio";
import PQueue from "p-queue";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getDb } from "../db/mongo.js";

/* ================= CONFIG ================= */
const CONCURRENCY = 2;
const TIMEOUT = 20000;
const MAX_CFP_LENGTH = 30000;

/* ================= PATH ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const CITY_FILE = path.join(ROOT, "scripts/cities15000.txt");
const CONTINENT_FILE = path.join(ROOT, "scripts/country_continent.json");

/* ================= GEO CACHE ================= */
let geoMap = null;
let continentMap = null;
let geoLoaded = false;

/* ================= GEO LOADER ================= */
async function initGeo() {
  if (geoLoaded) return;

  try {
    console.log("🌍 Loading geo...");

    const geoText = await fs.readFile(CITY_FILE, "utf8");
    const lines = geoText.split("\n");

    geoMap = new Map();

    for (const line of lines) {
      const cols = line.split("\t");

      const city = cols[1];
      const countryCode = cols[8];
      const lat = parseFloat(cols[4]);
      const lng = parseFloat(cols[5]);
      const feature = cols[7];
      const population = parseInt(cols[14] || "0");

      if (!city || !countryCode) continue;

      const key = city.toLowerCase();

      const obj = {
        country_code: countryCode,
        lat,
        lng,
        population,
        isCapital: feature === "PPLC",
      };

      if (!geoMap.has(key)) geoMap.set(key, []);
      geoMap.get(key).push(obj);
    }

    continentMap = JSON.parse(
      await fs.readFile(CONTINENT_FILE, "utf8")
    );

    geoLoaded = true;

    console.log(`✅ Geo loaded: ${geoMap.size} cities`);
  } catch (err) {
    console.error("❌ Geo load failed:", err.message);
    geoMap = new Map();
    continentMap = {};
    geoLoaded = true;
  }
}

/* ================= GEO ================= */
function normalizeCity(s) {
  return s
    .replace(/university|institute|college/gi, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCityCandidate(text) {
  const patterns = [
    /held at .*? in ([A-Za-z'’\-\s]+?)(?:\(|,|\s[A-Z][a-z]+)/i,
    /in ([A-Za-z'’\-\s]+?),\s*[A-Za-z ]+,\s*(?:from|on)/i,
    /in ([A-Za-z'’\-\s]+?)\s+\([^)]+\)\s+[A-Za-z]+/i,
  ];

  for (const regex of patterns) {
    const match = text.match(regex);
    if (match) return match[1];
  }

  return null;
}

function pickBestCity(candidates) {
  if (!candidates || candidates.length === 0) return null;

  const capital = candidates.find((c) => c.isCapital);
  if (capital) return capital;

  candidates.sort((a, b) => b.population - a.population);
  return candidates[0];
}

function extractGeo(text) {
  if (!geoMap) return {};

  const rawCity = extractCityCandidate(text);
  if (!rawCity) return {};

  const city = normalizeCity(rawCity);
  const candidates = geoMap.get(city.toLowerCase());

  if (!candidates) return { city };

  const best = pickBestCity(candidates);
  if (!best) return { city };

  return {
    city,
    country_code: best.country_code,
    continent: continentMap[best.country_code] || null,
    lat: best.lat,
    lng: best.lng,
  };
}

/* ================= AI LOCATION ================= */
const COUNTRY_TO_CODE = {
  italy: "IT",
  france: "FR",
  china: "CN",
  vietnam: "VN",
  "united states": "US",
  usa: "US",
  uk: "GB",
  germany: "DE",
  japan: "JP",
  spain: "ES",
  canada: "CA",
  peru: "PE",
};

async function extractLocationAI(text) {
  try {
    const prompt = `
Extract conference location from text.

Return ONLY JSON:
{
  "city": "...",
  "country": "..."
}

Text:
${text.slice(0, 2000)}
`;

    const res = await axios.post(
      process.env.OLLAMA_BASE_URL + "/api/generate",
      {
        model: process.env.OLLAMA_MODEL || "qwen3:8b",
        prompt,
        stream: false,
      },
      { timeout: 20000 }
    );

    const output = res.data.response;
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      city: parsed.city?.trim(),
      country: parsed.country?.trim(),
    };
  } catch {
    console.log("❌ AI location fail");
    return null;
  }
}

async function extractGeoSmart(text) {
  const ai = await extractLocationAI(text);

  if (ai && ai.city && ai.country) {
    const code = COUNTRY_TO_CODE[ai.country.toLowerCase()];

    if (code) {
      return {
        city: ai.city,
        country: ai.country,
        country_code: code,
        continent: continentMap[code] || null,
      };
    }
  }

  return extractGeo(text);
}

/* ================= TEXT ================= */
function cleanText(text) {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/EasyChair.*?Log in/i, "")
    .trim();
}

function safeCut(text) {
  if (text.length <= MAX_CFP_LENGTH) return text;

  let cut = text.slice(0, MAX_CFP_LENGTH);
  const lastDot = cut.lastIndexOf(".");

  if (lastDot > 1000) {
    cut = cut.slice(0, lastDot + 1);
  }

  return cut;
}

function trimCFP(text) {
  const stopKeywords = ["committee", "editor", "journal"];

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

  return `${match[3]}-${months[match[1].toLowerCase()]}-${match[2].padStart(2, "0")}`;
}

function extractDeadline(text) {
  const match = text.match(/(deadline|submission).*?([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
  return match ? parseDateToISO(match[2]) : null;
}

/* ================= LINK ================= */
function cleanLink(link) {
  const match = link?.match(/conf=[a-zA-Z0-9_-]+/);
  return match
    ? `https://easychair.org/conferences/?${match[0]}`
    : null;
}

/* ================= RANK ================= */
function rankConference(text) {
  let score = 0;

  if (/ieee/i.test(text)) score += 3;
  if (/springer/i.test(text)) score += 3;
  if (/scopus/i.test(text)) score += 2;

  if (score >= 7) return "A*";
  if (score >= 5) return "A";
  if (score >= 3) return "B";
  return "C";
}

/* ================= PARSER ================= */
async function parseEasyChair(html) {
  const $ = cheerio.load(html);
  $("script, style").remove();

  const bodyText = cleanText($("body").text());

  let cfp_text = "";

  $("p, h1, h2, h3").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 80) cfp_text += t + "\n";
  });

  cfp_text = safeCut(trimCFP(cfp_text));

  let submission_link = null;

  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!submission_link && href?.includes("conf=")) {
      submission_link = cleanLink(href);
    }
  });

  return {
    cfp_text,
    submission_link,
    deadline: extractDeadline(bodyText),
    rank: rankConference(bodyText),
    ...(await extractGeoSmart(bodyText)),
  };
}

/* ================= MAIN ================= */
async function run() {
  console.log("🚀 AI Enrich FINAL (AI + GEO)...");

  await initGeo();

  const db = await getDb();
  const col = db.collection("conference");

  const docs = await col.find({
    $or: [
      { cfp_text: { $exists: false } },
      { cfp_text: "" }
    ]
  }).limit(5000).toArray();

  const queue = new PQueue({ concurrency: CONCURRENCY });

  let count = 0;

  for (const doc of docs) {
    queue.add(async () => {
      try {
        console.log("🌐", doc.url);

        const res = await axios.get(doc.url, { timeout: TIMEOUT });

        const data = await parseEasyChair(res.data);

        await col.updateOne(
          { _id: doc._id },
          {
            $set: {
              ...data,
              status: "done",
              updated_time: new Date().toISOString()
            }
          }
        );

        count++;
        console.log("✅", count);
      } catch {
        console.log("❌", doc.url);
      }
    });
  }

  await queue.onIdle();

  console.log("🎯 DONE");
  process.exit(0);
}

run();