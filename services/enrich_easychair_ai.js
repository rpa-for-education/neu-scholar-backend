import axios from "axios";
import * as cheerio from "cheerio";
import PQueue from "p-queue";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getDb } from "../db/mongo.js";
import { COUNTRY_NAME_TO_ISO } from "../scripts/country_map.js";

/* ================= CONFIG ================= */
const CONCURRENCY = 2;
const TIMEOUT = 20000;
const MAX_CFP_LENGTH = 30000;

/* ================= PATH ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const CITY_FILE = path.join(ROOT, "scripts/cities15000.txt");
const COUNTRY_FILE = path.join(ROOT, "scripts/countryInfo.txt");

/* ================= GLOBAL ================= */
let geoMap = new Map();
let ISO_TO_COUNTRY = {};
let ISO_TO_CONTINENT = {};

/* ================= INIT GEO ================= */
function clean(s = "") {
  return s.toLowerCase().replace(/[()]/g, "").trim();
}

function titleCase(s = "") {
  return s
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function initGeo() {
  console.log("🌍 Loading Geo...");

  // country
  const countryText = await fs.readFile(COUNTRY_FILE, "utf8");

  countryText.split("\n").forEach(line => {
    if (!line || line.startsWith("#")) return;

    const cols = line.split("\t");
    const iso = cols[0];
    const name = cols[4];
    const continent = cols[8];

    ISO_TO_COUNTRY[iso] = name;

    ISO_TO_CONTINENT[iso] = {
      AF: "Africa",
      AS: "Asia",
      EU: "Europe",
      NA: "North America",
      SA: "South America",
      OC: "Oceania"
    }[continent] || null;
  });

  // cities
  const geoText = await fs.readFile(CITY_FILE, "utf8");

  geoText.split("\n").forEach(line => {
    const cols = line.split("\t");
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

  // GeoNames match
  if (geoMap.has(cityKey)) {
    return geoMap.get(cityKey);
  }

  // country fallback
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

/* ================= AI (FALLBACK ONLY) ================= */
function isValidLocation(ai) {
  if (!ai?.city || !ai?.country) return false;

  const bad = ["learning", "content", "security", "model", "data"];

  const city = ai.city.toLowerCase();

  if (city.length > 50) return false;
  if (bad.some(w => city.includes(w))) return false;

  return true;
}

async function extractLocationAI(text) {
  try {
    const res = await axios.post(
      process.env.OLLAMA_BASE_URL + "/api/generate",
      {
        model: process.env.OLLAMA_MODEL || "qwen3:8b",
        prompt: `Extract location JSON {city, country}:\n${text.slice(0, 1500)}`,
        stream: false
      },
      { timeout: 15000 }
    );

    const match = res.data.response.match(/\{[\s\S]*\}/);
    if (!match) return null;

    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/* ================= GEO SMART ================= */
async function extractGeoSmart(doc, text) {
  // 1. location field (BEST)
  if (doc.location) {
    const ex = extractFromLocation(doc.location);
    if (ex.city) {
      return {
        city: ex.city,
        country_code: ex.country_code,
        country: ISO_TO_COUNTRY[ex.country_code],
        continent: ISO_TO_CONTINENT[ex.country_code]
      };
    }
  }

  // 2. skip AI nếu text yếu
  if (text.length < 200) return {};

  // 3. AI fallback
  const ai = await extractLocationAI(text);

  if (isValidLocation(ai)) {
    const code = COUNTRY_NAME_TO_ISO[clean(ai.country)];
    if (code) {
      return {
        city: ai.city,
        country: ai.country,
        country_code: code,
        continent: ISO_TO_CONTINENT[code]
      };
    }
  }

  return {};
}

/* ================= CFP (FIX CHUẨN) ================= */
function extractCFP($) {
  $("script, style, nav, footer, header").remove();

  let text = $("body").text();

  text = text
    .replace(/EasyChair.*?Log in/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const parts = text.split(/(?<=\.)\s+/);

  const good = parts.filter(p =>
    p.length > 80 &&
    !/login|easychair|copyright/i.test(p)
  );

  let cfp = good.join("\n");

  // cut noise tail
  const stop = ["committee", "editor", "copyright"];
  let lower = cfp.toLowerCase();
  let cut = cfp.length;

  for (const s of stop) {
    const idx = lower.indexOf(s);
    if (idx !== -1 && idx < cut) cut = idx;
  }

  cfp = cfp.slice(0, cut);

  if (cfp.length > MAX_CFP_LENGTH) {
    cfp = cfp.slice(0, MAX_CFP_LENGTH);
  }

  if (cfp.length < 200) return null;

  return cfp.trim();
}

/* ================= DATE ================= */
function extractDeadline(text) {
  const match = text.match(/([A-Za-z]+ \d{1,2}, \d{4})/);
  if (!match) return null;

  return new Date(match[1]).toISOString().slice(0, 10);
}

/* ================= PARSER ================= */
async function parseEasyChair(doc, html) {
  const $ = cheerio.load(html);

  const bodyText = $("body").text();

  return {
    cfp_text: extractCFP($),
    deadline: extractDeadline(bodyText),
    ...(await extractGeoSmart(doc, bodyText))
  };
}

/* ================= MAIN ================= */
async function run() {
  console.log("🚀 ENRICH FINAL (STABLE + CLEAN CFP)");

  await initGeo();

  const db = await getDb();
  const col = db.collection("conference");

  const docs = await col.find({}).limit(5000).toArray();

  const queue = new PQueue({ concurrency: CONCURRENCY });

  let done = 0;

  for (const doc of docs) {
    queue.add(async () => {
      try {
        const res = await axios.get(doc.url, { timeout: TIMEOUT });

        const data = await parseEasyChair(doc, res.data);

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

        done++;
        console.log("✅", done);
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