import axios from "axios";
import * as cheerio from "cheerio";
import { MongoClient } from "mongodb";
import crypto from "crypto";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

/* ================= CONFIG ================= */
const client = new MongoClient(process.env.MONGODB_URI);
const DB_NAME = process.env.DB_NAME || "fitneu";
const COLLECTION = "conference";
const URL = "https://easychair.org/cfp2/";

/* ================= PATH ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COUNTRY_FILE = path.join(__dirname, "../scripts/countryInfo.txt");
const CITY_FILE = path.join(__dirname, "../scripts/cities15000.txt");
const CITY_FALLBACK = path.join(__dirname, "../scripts/city_country_map.json");

/* ================= HASH ================= */
const hash = (obj) =>
  crypto.createHash("md5").update(JSON.stringify(obj)).digest("hex");

/* ================= GEO ================= */
let geoMap = new Map();
let fallbackMap = {};
let ISO_TO_COUNTRY = {};
let ISO_TO_CONTINENT = {};

function clean(s = "") {
  return s.toLowerCase().replace(/[()]/g, "").trim();
}

async function initGeo() {
  console.log("🌍 Loading Geo dataset...");

  const countryText = await fs.readFile(COUNTRY_FILE, "utf8");

  countryText.split("\n").forEach(line => {
    if (!line || line.startsWith("#")) return;

    const cols = line.split("\t");
    const iso = cols[0];
    const name = cols[4];
    const continent = cols[8];

    if (!iso) return;

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

  const geoText = await fs.readFile(CITY_FILE, "utf8");

  geoText.split("\n").forEach(line => {
    const cols = line.split("\t");
    if (cols.length < 9) return;

    const city = clean(cols[1]);
    const country_code = cols[8];

    if (city && country_code) {
      geoMap.set(city, {
        city: cols[1],
        country_code
      });
    }
  });

  try {
    const fallbackText = await fs.readFile(CITY_FALLBACK, "utf8");
    fallbackMap = JSON.parse(fallbackText);
  } catch {
    console.log("⚠️ No fallback map");
  }

  console.log(`✅ Geo loaded: ${geoMap.size} cities`);
}

/* ================= LOCATION ================= */
function extractLocation(location = "") {
  if (!location) return {};

  const parts = location.split(",").map(s => s.trim());
  const cityRaw = parts[0];
  const cityKey = clean(cityRaw);

  let geo = geoMap.get(cityKey);

  if (!geo && fallbackMap[cityRaw]) {
    const fb = fallbackMap[cityRaw];

    return {
      city: cityRaw,
      country_code: fb.country_code || null,
      country: ISO_TO_COUNTRY[fb.country_code] || null,
      continent: fb.continent || null
    };
  }

  if (!geo) return {};

  const country_code = geo.country_code;

  return {
    city: geo.city,
    country_code,
    country: ISO_TO_COUNTRY[country_code] || null,
    continent: ISO_TO_CONTINENT[country_code] || null
  };
}

/* ================= DATE ================= */
function parseDate(text = "") {
  try {
    const d = new Date(text);
    if (isNaN(d)) return text;
    return d.toISOString().slice(0, 10);
  } catch {
    return text;
  }
}

/* ================= TOPIC ================= */
function parseTopics(raw = "") {
  if (!raw) return [];

  raw = raw.replace(/\s+/g, " ").trim().toLowerCase();

  if (raw.includes(",")) {
    return [...new Set(
      raw.split(",").map(t => t.trim()).filter(Boolean)
    )];
  }

  // fallback đơn giản (không over-engineer)
  return raw
    .split(/(?=\b(ai|data|learning|model|analysis|prediction|classification)\b)/gi)
    .map(t => t.trim())
    .filter(t => t.length > 3);
}

/* ================= MAIN ================= */
async function run() {
  await client.connect();
  console.log("✅ MongoDB connected");

  await initGeo();

  const db = client.db(DB_NAME);
  const col = db.collection(COLLECTION);

  await col.createIndex({ _key: 1 }, { unique: true });

  console.log("🚀 Crawling...");

  const { data } = await axios.get(URL);
  const $ = cheerio.load(data);

  const rows = $("table tbody tr");

  let inserted = 0;
  let updated = 0;

  for (const row of rows.toArray()) {
    const cols = $(row).find("td");
    if (cols.length < 6) continue;

    const linkEl = $(cols[0]).find("a").first();
    if (!linkEl.length) continue;

    const acronym = linkEl.text().trim();

    // filter row rác
    if (!acronym || acronym.length > 100 || acronym.includes("EasyChair")) {
      continue;
    }

    const name = $(cols[1]).text().trim();
    const location = $(cols[2]).text().trim();

    const deadline = parseDate($(cols[3]).text().trim());
    const start_date = parseDate($(cols[4]).text().trim());

    const topics = parseTopics($(cols[5]).text());

    let link = linkEl.attr("href");
    if (link && !link.startsWith("http")) {
      link = "https://easychair.org" + link;
    }

    const geo = extractLocation(location);

    const _key = `${acronym}_${start_date}`;

    const newDoc = {
      _key,
      acronym,
      name,
      location,
      ...geo,
      deadline,
      start_date,
      topics,
      url: link
    };

    const newHash = hash(newDoc);

    const res = await col.updateOne(
      { _key },
      {
        $set: {
          ...newDoc,
          hash: newHash,
          status: "pending",
          updated_time: new Date()
        }
      },
      { upsert: true }
    );

    if (res.upsertedCount) inserted++;
    else if (res.modifiedCount) updated++;
  }

  console.log({ inserted, updated });

  console.log("🎯 DONE");
  await client.close();
}

run();