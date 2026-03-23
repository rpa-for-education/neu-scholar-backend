import axios from "axios";
import * as cheerio from "cheerio";
import PQueue from "p-queue";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { getDb } from "../db/mongo.js";

/* ================= CONFIG ================= */
const CONCURRENCY = 2;
const TIMEOUT = 20000;
const MAX_CFP_LENGTH = 30000;

/* ================= COUNTRY MAP (EMBED) ================= */
const COUNTRY_NAME_TO_ISO = {
  "italy": "IT",
  "france": "FR",
  "china": "CN",
  "vietnam": "VN",
  "united states": "US",
  "usa": "US",
  "uk": "GB",
  "united kingdom": "GB",
  "germany": "DE",
  "japan": "JP",
  "spain": "ES",
  "canada": "CA",
  "peru": "PE",
  "qatar": "QA",
  "india": "IN",
  "netherlands": "NL",
  "switzerland": "CH",
  "australia": "AU",
  "singapore": "SG"
};

/* ================= PATH (FIX CHUẨN DOCKER) ================= */
const __filename = fileURLToPath(import.meta.url);

// 👉 dùng URL relative → KHÔNG lỗi path trong Docker
const CITY_FILE = new URL("../scripts/cities15000.txt", import.meta.url);
const COUNTRY_FILE = new URL("../scripts/countryInfo.txt", import.meta.url);

/* ================= GLOBAL ================= */
let geoMap = new Map();
let ISO_TO_COUNTRY = {};
let ISO_TO_CONTINENT = {};

/* ================= HELPER ================= */
function clean(s = "") {
  return s.toLowerCase().replace(/[()]/g, "").trim();
}

function titleCase(s = "") {
  return s
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/* ================= INIT GEO ================= */
async function initGeo() {
  console.log("🌍 Loading Geo...");

  // 👉 load country
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

  // 👉 load city
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

  // match city
  if (geoMap.has(cityKey)) {
    return geoMap.get(cityKey);
  }

  // fallback country
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
  $("script, style, nav, footer, header").remove();

  let text = $("body").text();

  text = text
    .replace(/EasyChair.*?Log in/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const parts = text.split(/(?<=\.)\s+/);

  const good = parts.filter(p =>
    p.length > 80 &&
    !/login|easychair/i.test(p)
  );

  let cfp = good.join("\n");

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
    ...extractFromLocation(doc.location || "")
  };
}

/* ================= MAIN ================= */
async function run() {
  console.log("🚀 ENRICH FINAL (FIXED PATH)");

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
        console.log(`✅ ${done}`);
      } catch (err) {
        console.log("❌", doc.url);
      }
    });
  }

  await queue.onIdle();

  console.log("🎯 DONE");
  process.exit(0);
}

run();