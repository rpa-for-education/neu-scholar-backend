import axios from "axios";
import * as cheerio from "cheerio";
import { MongoClient } from "mongodb";
import crypto from "crypto";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const client = new MongoClient(process.env.MONGODB_URI);
const DB_NAME = process.env.DB_NAME || "fitneu";
const COLLECTION = "conference";

const URL = "https://easychair.org/cfp2/";

const hash = (obj) =>
  crypto.createHash("md5").update(JSON.stringify(obj)).digest("hex");

/* ================= PATH FIX (QUAN TRỌNG) ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COUNTRY_FILE = path.join(__dirname, "../scripts/countryInfo.txt");
const CITY_FILE = path.join(__dirname, "../scripts/cities15000.txt");
const CITY_FALLBACK = path.join(__dirname, "../scripts/city_country_map.json");

/* ================= GEO ================= */
let geoMap = new Map();
let fallbackMap = {};
let ISO_TO_COUNTRY = {};
let ISO_TO_CONTINENT = {};

function clean(s = "") {
  return s.toLowerCase().replace(/[()]/g, "").trim();
}

/* ================= LOAD GEO ================= */
async function initGeo() {
  console.log("🌍 Loading Geo dataset...");

  // country
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

  // cities
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

  // fallback
  try {
    const fallbackText = await fs.readFile(CITY_FALLBACK, "utf8");
    fallbackMap = JSON.parse(fallbackText);
  } catch {
    console.log("⚠️ No fallback map loaded");
  }

  console.log(`✅ Geo loaded: ${geoMap.size} cities`);
}

/* ================= LOCATION ================= */
function extractLocation(location = "") {
  if (!location) return {};

  const parts = location.split(",").map(s => s.trim());

  const cityRaw = parts[0];
  const cityKey = clean(cityRaw);

  // 1. geo dataset
  let geo = geoMap.get(cityKey);

  // 2. fallback
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
  const country = ISO_TO_COUNTRY[country_code] || null;
  const continent = ISO_TO_CONTINENT[country_code] || null;

  return {
    city: geo.city,
    country_code,
    country,
    continent
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

/* ================= REMOVE DUP ================= */
async function removeDuplicates(col) {
  const cursor = col.aggregate([
    { $sort: { updated_time: -1 } },
    {
      $group: {
        _id: {
          acronym: "$acronym",
          start_date: "$start_date"
        },
        ids: { $push: "$_id" },
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]);

  let removed = 0;

  for await (const doc of cursor) {
    doc.ids.shift();
    const res = await col.deleteMany({ _id: { $in: doc.ids } });
    removed += res.deletedCount;
  }

  console.log(`🗑️ Removed: ${removed}`);
}

/* ================= MAIN ================= */
async function run() {
  await client.connect();
  console.log("✅ MongoDB connected");

  await initGeo();

  const db = client.db(DB_NAME);
  const col = db.collection(COLLECTION);

  console.log("🚀 Crawling...");

  const { data } = await axios.get(URL);
  const $ = cheerio.load(data);

  const rows = $("table tbody tr");

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows.toArray()) {
    const cols = $(row).find("td");
    if (cols.length < 6) continue;

    const acronym = $(cols[0]).text().trim();
    const name = $(cols[1]).text().trim();
    const location = $(cols[2]).text().trim();

    const deadline = parseDate($(cols[3]).text().trim());
    const start_date = parseDate($(cols[4]).text().trim());

    const topics_raw = $(cols[5]).text().trim();
    const topics = topics_raw
      ? topics_raw.split(",").map(t => t.trim()).filter(Boolean)
      : [];

    const geo = extractLocation(location);

    let link = $(cols[0]).find("a").attr("href");
    if (link && !link.startsWith("http")) {
      link = "https://easychair.org" + link;
    }

    const newDoc = {
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

    const existing = await col.findOne({ acronym, start_date });

    if (!existing) {
      await col.insertOne({
        ...newDoc,
        hash: newHash,
        status: "pending",
        updated_time: new Date()
      });
      inserted++;
      continue;
    }

    if (existing.hash === newHash) {
      skipped++;
      continue;
    }

    await col.updateOne(
      { _id: existing._id },
      {
        $set: {
          ...newDoc,
          hash: newHash,
          status: "pending",
          updated_time: new Date()
        }
      }
    );

    updated++;
  }

  console.log({ inserted, updated, skipped });

  await removeDuplicates(col);

  await col.createIndex(
    { acronym: 1, start_date: 1 },
    { unique: true }
  );

  console.log("🎯 DONE");
  await client.close();
}

run();