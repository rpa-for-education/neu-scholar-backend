import fs from "fs/promises";
import path from "path";
import { getDb } from "../db.js";

/* ===================== CONFIG ===================== */

const CITY_FILE = path.resolve("scripts/cities15000.txt");
const COUNTRY_FILE = path.resolve("scripts/countryInfo.txt");
const BULK_SIZE = 100;

/* ===================== CONSTANTS ===================== */

const CONTINENT_NAME = {
  AF: "Africa",
  AS: "Asia",
  EU: "Europe",
  NA: "North America",
  SA: "South America",
  OC: "Oceania",
  AN: "Antarctica"
};

/* ===================== CITY ALIAS ===================== */
/* Alias cho các trường hợp GeoNames KHÔNG BAO PHỦ */

const CITY_ALIAS = {
  // China
  zhuhai: { city: "Zhuhai", country_code: "CN" },

  // Macau / Macao
  macao: { city: "Macao", country_code: "MO" },
  macau: { city: "Macao", country_code: "MO" },

  // Taiwan
  taichung: { city: "Taichung City", country_code: "TW" },
  "taichung city": { city: "Taichung City", country_code: "TW" },
  taipei: { city: "Taipei", country_code: "TW" },

  // Korea
  "muju county": { city: "Muju", country_code: "KR" },
  muju: { city: "Muju", country_code: "KR" }
};

/* ===================== UTILS ===================== */

function clean(s = "") {
  return s
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(s = "") {
  return s
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* ===================== LOAD COUNTRY ===================== */

async function loadCountryMaps() {
  const ISO_TO_COUNTRY = {};
  const COUNTRY_TO_ISO = {};
  const ISO_TO_CONTINENT = {};

  const text = await fs.readFile(COUNTRY_FILE, "utf8");

  text.split("\n").forEach(line => {
    if (!line || line.startsWith("#")) return;

    const cols = line.split("\t");
    const iso = cols[0];            // CN
    const name = cols[4];           // China
    const continentCode = cols[8];  // AS

    if (!iso || !name) return;

    ISO_TO_COUNTRY[iso] = name;
    COUNTRY_TO_ISO[clean(name)] = iso;
    ISO_TO_CONTINENT[iso] =
      CONTINENT_NAME[continentCode] || null;
  });

  return { ISO_TO_COUNTRY, COUNTRY_TO_ISO, ISO_TO_CONTINENT };
}

/* ===================== LOAD GEONAMES ===================== */

async function loadGeoNames() {
  const geoMap = new Map();
  const text = await fs.readFile(CITY_FILE, "utf8");

  text.split("\n").forEach(line => {
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

  return geoMap;
}

/* ===================== EXTRACT LOCATION ===================== */

function extractFromLocation(location, geoMap, COUNTRY_TO_ISO) {
  if (!location) return {};

  const parts = location.split(",").map(s => s.trim());
  const rawCity = parts[0];
  const cityKey = clean(rawCity);

  // 0️⃣ City alias (ưu tiên cao nhất)
  if (CITY_ALIAS[cityKey]) {
    return CITY_ALIAS[cityKey];
  }

  // 1️⃣ GeoNames
  if (geoMap.has(cityKey)) {
    return geoMap.get(cityKey);
  }

  // 2️⃣ Country name ở phần sau
  for (let i = parts.length - 1; i >= 1; i--) {
    const key = clean(parts[i]);
    if (COUNTRY_TO_ISO[key]) {
      return {
        city: titleCase(rawCity),
        country_code: COUNTRY_TO_ISO[key]
      };
    }
  }

  // 3️⃣ Chỉ có city
  return {
    city: titleCase(rawCity)
  };
}

/* ===================== MAIN ===================== */

(async () => {
  console.log("🔌 Connecting MongoDB...");
  const db = await getDb();
  const col = db.collection("conference");
  console.log(`✅ MongoDB connected → DB: ${db.databaseName}`);

  console.log("📦 Loading country & continent info...");
  const {
    ISO_TO_COUNTRY,
    COUNTRY_TO_ISO,
    ISO_TO_CONTINENT
  } = await loadCountryMaps();

  console.log("🗺 Loading GeoNames...");
  const geoMap = await loadGeoNames();
  console.log(`🗺 GeoNames loaded: ${geoMap.size} cities`);

  const total = await col.countDocuments({
    location: { $exists: true, $ne: null }
  });

  console.log(`📊 Total conferences to process: ${total}`);
  console.log("⏳ Starting normalization...\n");

  const cursor = col.find({
    location: { $exists: true, $ne: null }
  });

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let bulk = [];

  const start = Date.now();

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    processed++;

    const extracted =
      extractFromLocation(doc.location, geoMap, COUNTRY_TO_ISO);

    if (!extracted.city) {
      skipped++;
      continue;
    }

    const update = {};
    let shouldUpdate = false;

    // City
    if (!doc.city && extracted.city) {
      update.city = extracted.city;
      shouldUpdate = true;
    }

    // Country + continent (chỉ bổ sung nếu thiếu)
    if (
      extracted.country_code &&
      (!doc.country_code || !doc.country || !doc.continent)
    ) {
      update.country_code = extracted.country_code;
      update.country =
        ISO_TO_COUNTRY[extracted.country_code] ||
        extracted.country_code;
      update.continent =
        ISO_TO_CONTINENT[extracted.country_code] || null;
      shouldUpdate = true;
    }

    if (!shouldUpdate) {
      skipped++;
      continue;
    }

    bulk.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: update }
      }
    });

    if (bulk.length >= BULK_SIZE) {
      await col.bulkWrite(bulk);
      updated += bulk.length;
      bulk = [];

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(
        `⏳ ${processed}/${total} | ✅ ${updated} | ⚠ ${skipped} | ${elapsed}s`
      );

      await sleep(50);
    }
  }

  if (bulk.length) {
    await col.bulkWrite(bulk);
    updated += bulk.length;
  }

  console.log("\n====================================");
  console.log("🎯 LOCATION NORMALIZATION DONE");
  console.log(`📄 Processed : ${processed}`);
  console.log(`✅ Updated   : ${updated}`);
  console.log(`⚠ Skipped   : ${skipped}`);
  console.log("====================================");

  process.exit(0);
})().catch(err => {
  console.error("❌ FATAL ERROR:", err);
  process.exit(1);
});
