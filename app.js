// app.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import axios from "axios";
import { callLLM } from "./llm.js";
import { journalVectorSearch, conferenceVectorSearch, initEmbedding } from "./search.js";
import { getDb } from "./db.js";
import { encode } from "gpt-tokenizer";

const app = express();
const PORT = 4000;
const DEFAULT_MODEL_ID = "qwen-max";

app.use(cors());
app.use(express.json({ limit: "10mb" }));

let db;
async function getCollection(name) {
  if (!db) db = await getDb();
  return db.collection(name);
}

async function Journals() {
  return getCollection("journal");
}
async function Conferences() {
  return getCollection("conference");
}

function parseBool(v) {
  return String(v).toLowerCase() === "true";
}
function getProjection(includeVector) {
  return includeVector ? {} : { vector: 0 };
}

/* ===================== HEALTH ===================== */
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", db: db ? "connected" : "disconnected", time: new Date().toISOString() });
});

/* ===================== JOURNALS ===================== */
app.get("/api/journals", async (_req, res) => {
  try {
    const col = await Journals();

    // 🎯 projection chỉ giữ các field cần thiết và đổi tên
    const cursor = col.aggregate([
      {
        $project: {
          _id: 0,
          name: "$title",
          quartiles: "$categories",
          publisher: "$publisher",
        },
      },
    ], { allowDiskUse: true });

    const items = await cursor.toArray();
    res.json({ total: items.length, items });
  } catch (err) {
    console.error("❌ /api/journals error:", err);
    res.status(500).json({ error: "Failed to fetch journals", detail: err.message });
  }
});

/* ===================== CONFERENCES ===================== */
app.get("/api/conferences", async (_req, res) => {
  try {
    const col = await Conferences();

    // 🎯 projection chỉ giữ các field cần thiết và đổi tên
    const cursor = col.aggregate([
      {
        $project: {
          _id: 0,
          name: "$title",
          url: "$url",
        },
      },
    ], { allowDiskUse: true });

    const items = await cursor.toArray();
    res.json({ total: items.length, items });
  } catch (err) {
    console.error("❌ /api/conferences error:", err);
    res.status(500).json({ error: "Failed to fetch conferences", detail: err.message });
  }
});

/* ===================== Các API khác giữ nguyên ===================== */
// ... (toàn bộ phần CRUD journals, conferences, agent, v.v. bạn giữ nguyên từ file cũ)

/* ===================== Boot ===================== */
if (!process.env.VERCEL) {
  app.listen(PORT, async () => {
    console.log(`➡️ API listening on http://localhost:${PORT}`);
    initEmbedding().catch(e => console.error("Embedding preload failed:", e.message));
  });
}

export default app;
