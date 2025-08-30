// import.js
import fs from "fs";
import axios from "axios";
import { MongoClient } from "mongodb";
import pLimit from "p-limit";
import cliProgress from "cli-progress";
import ora from "ora";
import { pipeline } from "@xenova/transformers";   // ✅ local embedding
import "dotenv/config";

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "rpa";
const API_RESEARCH = process.env.API_RESEARCH || "https://api.rpa4edu.shop/api_research.php";
const API_JOURNAL = process.env.API_JOURNAL || "https://api.rpa4edu.shop/api_journal.php";

const client = new MongoClient(MONGODB_URI);

// ===== Embedding helper (768 chiều với Xenova/paraphrase-multilingual-mpnet-base-v2) =====
let embedder = null;
async function initEmbedder() {
  if (!embedder) {
    console.log("⏳ Loading local embedding model (paraphrase-multilingual-mpnet-base-v2, 768d)...");
    embedder = await pipeline("feature-extraction", "Xenova/paraphrase-multilingual-mpnet-base-v2");
    console.log("✅ Model loaded (768d)");
  }
  return embedder;
}

async function embedBatch(texts) {
  const emb = await (await initEmbedder())(texts, { pooling: "mean", normalize: true });
  return texts.map((_, i) => Array.from(emb[i]));
}

// ===== Streaming fetch with spinner =====
async function fetchJsonStream(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const connectSpinner = ora(`📡 Connecting to ${url}`).start();
      const res = await axios.get(url, {
        responseType: "stream",
        timeout: 60000,
      });
      connectSpinner.succeed(`✔ 📡 Connected to ${url}`);

      let data = "";
      let size = 0;
      const startTime = Date.now();

      const spinner = ora("📥 Downloading...").start();
      const interval = setInterval(() => {
        const mb = (size / 1024 / 1024).toFixed(1);
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? (size / 1024 / 1024 / elapsed).toFixed(1) : "0.0";
        spinner.text = `📥 Downloading... ${mb} MB | ${speed} MB/s`;
      }, 500);

      for await (const chunk of res.data) {
        size += chunk.length;
        data += chunk.toString("utf8");
      }

      clearInterval(interval);
      spinner.succeed("✔ 📥 Download complete");

      return JSON.parse(data);
    } catch (err) {
      console.error(`❌ Fetch error (attempt ${attempt}) from ${url}:`, err.message);
      if (attempt < retries) {
        console.log(`⏳ Retry in 5s...`);
        await new Promise((r) => setTimeout(r, 5000));
      } else {
        throw err;
      }
    }
  }
}

// ===== Deep equal (so sánh dữ liệu cũ - mới) =====
function isEqualExceptVector(a, b) {
  const ignore = new Set(["_id", "vector"]);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (ignore.has(k)) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      return false;
    }
  }
  return true;
}

// ===== Import collection =====
async function importCollection(db, name, records, fields) {
  if (!records?.length) {
    console.warn(`⚠️ No data for collection "${name}"`);
    return;
  }

  const spinner = ora(`🔍 Checking existing docs in "${name}"...`).start();

  const existing = await db.collection(name).find({}, { projection: { _id: 0 } }).toArray();
  const existingMap = new Map(existing.map(x => [x._key, x]));

  spinner.succeed(`📊 ${records.length} total records to process in "${name}"`);

  // 🚀 Force update: ép import lại tất cả records
  const toProcess = records.map(r => ({ item: r, reason: "force-update" }));

  console.log(`📦 ${toProcess.length} docs will be re-imported into "${name}"...`);

  const contents = toProcess.map(({ item }) =>
    fields
      .map((f) => {
        const val = item[f];
        return Array.isArray(val) ? val.join(" ") : val || "";
      })
      .filter(Boolean)
      .join(" ")
  );

  const BATCH_SIZE = 25;
  let vectors = [];

  // 🟢 Bước 1: EMBEDDING
  const embedBar = new cliProgress.SingleBar(
    { format: `   → Embedding [{bar}] {percentage}% | {value}/{total}`, hideCursor: true, barsize: 30 },
    cliProgress.Presets.shades_classic
  );
  embedBar.start(contents.length, 0);

  for (let i = 0; i < contents.length; i += BATCH_SIZE) {
    const batch = contents.slice(i, i + BATCH_SIZE);
    const vecs = await embedBatch(batch);
    vectors.push(...vecs);
    embedBar.update(Math.min(i + batch.length, contents.length));
  }
  embedBar.stop();
  console.log("✔ Embedding finished (MiniLM-L12-v2, 768d)");

  // 🟢 Bước 2: UPDATE DB
  const limit = pLimit(10);
  const updateBar = new cliProgress.SingleBar(
    { format: `   → Writing DB [{bar}] {percentage}% | {value}/{total}`, hideCursor: true, barsize: 30 },
    cliProgress.Presets.shades_classic
  );
  updateBar.start(toProcess.length, 0);

  let done = 0;
  await Promise.all(
    toProcess.map(({ item }, idx) =>
      limit(async () => {
        await db.collection(name).updateOne(
          { _key: item._key },
          { $set: { ...item, vector: vectors[idx] } },
          { upsert: true }
        );
        done++;
        updateBar.update(done);
      })
    )
  );
  updateBar.stop();
  console.log(`✔ Upserted ${toProcess.length} docs into "${name}"`);
}

// ===== Main =====
(async () => {
  try {
    await client.connect();
    const db = client.db(MONGODB_DB);
    console.log(`✅ MongoDB connected (import.js) → DB: ${MONGODB_DB}`);

    const conferences = await fetchJsonStream(API_RESEARCH);
    console.log(`📊 Conferences fetched: ${conferences.length}`);

    const journals = await fetchJsonStream(API_JOURNAL);
    console.log(`📊 Journals fetched: ${journals.length}`);

    await importCollection(
      db,
      "conference",
      conferences.map(c => ({ ...c, _key: `${c.acronym || ""} ${c.name || ""}`.trim() })),
      ["_key", "publisher", "description"]
    );

    await importCollection(
      db,
      "journal",
      journals.map(j => ({ ...j, _key: j.title || "" })),
      ["_key", "publisher", "description"]
    );

    console.log("🎯 Import finished (all data up-to-date with vectors, 768d).");
  } catch (err) {
    console.error("❌ Import failed:", err);
  } finally {
    await client.close();
    console.log("🔌 MongoDB connection closed");
  }
})();
