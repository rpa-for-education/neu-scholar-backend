import fs from "fs/promises";
import path from "path";
import { getDb } from "../db.js";

const CITY_FILE = path.resolve("scripts/cities15000.txt");
const OUTPUT = path.resolve("scripts/city_country_map.json");
const CONTINENT_FILE = path.resolve("scripts/country_continent.json");

function normalizeCity(s) {
  return s
    .replace(/\s+/g, " ")
    .replace(/,\s*[^,]+$/, "")
    .trim();
}

(async () => {
  const db = await getDb();
  const col = db.collection("conference");

  // 1. Lấy toàn bộ location
  const locations = await col.distinct("location");
  const citySet = new Set(
    locations.map(l => normalizeCity(l)).filter(Boolean)
  );

  console.log(`📍 Found ${citySet.size} unique cities`);

  // 2. Load GeoNames
  const geoText = await fs.readFile(CITY_FILE, "utf8");
  const geoLines = geoText.split("\n");

  const geoMap = new Map();
  for (const line of geoLines) {
    const cols = line.split("\t");
    const city = cols[1];
    const countryCode = cols[8];
    if (city && countryCode) {
      geoMap.set(city.toLowerCase(), countryCode);
    }
  }

  const continentMap = JSON.parse(
    await fs.readFile(CONTINENT_FILE, "utf8")
  );

  // 3. Match
  const result = {};
  let matched = 0;

  for (const city of citySet) {
    const code = geoMap.get(city.toLowerCase());
    if (!code) continue;

    result[city] = {
      country_code: code,
      country: code,       // tạm, sẽ enrich sau nếu muốn
      continent: continentMap[code] || null
    };
    matched++;
  }

  await fs.writeFile(OUTPUT, JSON.stringify(result, null, 2));
  console.log(`✅ Generated city_country_map.json`);
  console.log(`✔ Matched: ${matched}`);
  console.log(`⚠ Unmatched: ${citySet.size - matched}`);

  process.exit(0);
})();