// scripts/normalize_conference_location.js
import fs from "fs/promises";
import path from "path";
import { getDb } from "../db.js";

const MAP_FILE = path.resolve("scripts/city_country_map.json");

/**
 * Chuẩn hoá location thô → city
 * - "Hangzhou, China" → "Hangzhou"
 * - "Paris (France)" → "Paris"
 */
function normalizeCity(raw) {
  if (!raw || typeof raw !== "string") return null;
  return raw
    .replace(/\(.*?\)/g, "")     // bỏ (...)
    .replace(/,\s*[^,]+$/, "")   // bỏ , Country
    .replace(/\s+/g, " ")
    .trim();
}

(async () => {
  const db = await getDb();
  console.log("✅ MongoDB connected");

  // 1️⃣ Load city → country map
  const cityMap = JSON.parse(await fs.readFile(MAP_FILE, "utf8"));
  console.log(`🗺 Loaded ${Object.keys(cityMap).length} city mappings`);

  const col = db.collection("conference");

  // 2️⃣ Lấy các conference cần xử lý
  const cursor = col.find({
    location: { $exists: true, $ne: "" },
    country: { $exists: false }   // tránh update lại
  });

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    processed++;

    const rawLocation = doc.location;
    const city = normalizeCity(rawLocation);

    if (!city || !cityMap[city]) {
      skipped++;
      continue;
    }

    const info = cityMap[city];

    await col.updateOne(
      { _id: doc._id },
      {
        $set: {
          city,
          country: info.country || info.country_code,
          country_code: info.country_code,
          continent: info.continent
        }
      }
    );

    updated++;

    if (processed % 100 === 0) {
      console.log(
        `⏳ Processed ${processed} | Updated ${updated} | Skipped ${skipped}`
      );
    }
  }

  console.log("====================================");
  console.log("🎯 LOCATION NORMALIZATION DONE");
  console.log(`📄 Processed : ${processed}`);
  console.log(`✅ Updated   : ${updated}`);
  console.log(`⚠ Skipped   : ${skipped}`);
  console.log("====================================");

  process.exit(0);
})();
