import { chromium } from "playwright";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { MongoClient } from "mongodb";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const client = new MongoClient(process.env.MONGODB_URI);

const DB_NAME = process.env.DB_NAME || "fitneu";
const COLLECTION = "conference";

const CONCURRENCY = 1; // 🔥 tránh overload OLLAMA
const limit = pLimit(CONCURRENCY);

const OLLAMA_URL = process.env.OLLAMA_BASE_URL + "/api/generate";
const MODEL = "qwen3:8b";

/* ================= INIT ================= */
let browser;
let context;

async function init() {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
}

/* ================= FETCH ================= */
async function fetchHtml(url) {
  const page = await context.newPage();

  try {
    console.log("🌐 Fetch:", url);

    await page.goto(url, {
      timeout: 15000,
      waitUntil: "domcontentloaded",
    });

    const html = await page.content();
    await page.close();
    return html;
  } catch {
    console.log("❌ Fetch fail");
    await page.close();
    return "";
  }
}

/* ================= CLEAN ================= */
function cleanText(html) {
  const $ = cheerio.load(html);

  $("script, style, nav, footer").remove();

  return $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
}

/* ================= FALLBACK PARSER ================= */
function fallbackParser(text) {
  console.log("🧠 Using fallback parser...");

  // deadline (regex)
  const deadlineMatch = text.match(
    /(deadline|due).*?(\d{4}[-/]\d{2}[-/]\d{2})/i
  );

  // link
  const linkMatch = text.match(/https?:\/\/[^\s]+/);

  // topics
  let topics = [];
  const topicMatch = text.match(/topics?:\s*(.+)/i);
  if (topicMatch) {
    topics = topicMatch[1]
      .split(",")
      .map((t) => t.trim())
      .slice(0, 10);
  }

  return {
    cfp_text: text.slice(0, 2000),
    topics,
    deadline: deadlineMatch ? deadlineMatch[2] : null,
    submission_link: linkMatch ? linkMatch[0] : null,
    keywords: topics.slice(0, 5),
  };
}

/* ================= SAFE JSON PARSER ================= */
function safeParseJSON(output) {
  output = output
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // try direct
  try {
    return JSON.parse(output);
  } catch {}

  // extract JSON
  const match = output.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/* ================= CALL OLLAMA ================= */
async function callOllama(text) {
  try {
    console.log("🤖 Calling OLLAMA...");

    const prompt = `
Trích xuất thông tin hội thảo.

⚠️ BẮT BUỘC:
- Chỉ trả JSON
- Không giải thích
- Không markdown

{
  "cfp_text": "...",
  "topics": ["..."],
  "deadline": "YYYY-MM-DD hoặc null",
  "submission_link": "...",
  "keywords": ["..."]
}

TEXT:
${text}
`;

    const res = await axios.post(
      OLLAMA_URL,
      {
        model: MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.1
        }
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 60000
      }
    );

    const output = res.data?.response || "";

    const parsed = safeParseJSON(output);

    if (!parsed) {
      console.log("❌ AI parse fail → fallback");
      return fallbackParser(text);
    }

    return parsed;

  } catch (err) {
    console.log("❌ OLLAMA error → fallback");
    return fallbackParser(text);
  }
}

/* ================= MAIN ================= */
async function run() {
  await client.connect();
  console.log("🚀 AI Enrich FULL (Ollama + Fallback)...");

  const db = client.db(DB_NAME);
  const col = db.collection(COLLECTION);

  await init();

  const cursor = col.find({
    $or: [
      { cfp_text: { $exists: false } },
      { cfp_text: "" },
      { status: "pending" }
    ]
  });

  let processed = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();

    await limit(async () => {
      try {
        if (!doc.url) return;

        if (doc.cfp_text && doc.cfp_text.length > 300) return;

        const html = await fetchHtml(doc.url);
        if (!html) return;

        const text = cleanText(html);

        const data = await callOllama(text);
        if (!data) return;

        await col.updateOne(
          { _id: doc._id },
          {
            $set: {
              ...data,
              status: "done",
              enriched_time: new Date(),
              cfp_length: data.cfp_text?.length || 0
            }
          }
        );

        processed++;
        console.log(`✅ Done: ${processed}`);

      } catch {
        console.log("❌ Task error");
      }
    });
  }

  console.log("🎯 AI ENRICH DONE");

  await browser.close();
  await client.close();
}

run();