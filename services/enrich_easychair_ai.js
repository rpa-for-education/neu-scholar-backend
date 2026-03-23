import axios from "axios";
import * as cheerio from "cheerio";
import PQueue from "p-queue";
import { getDb } from "../db/mongo.js";

/* ================= CONFIG ================= */
const CONCURRENCY = 2;
const TIMEOUT = 20000;

const OLLAMA_URL =
  process.env.OLLAMA_BASE_URL + "/api/generate";

const MODEL = "qwen3:8b";

/* ================= UTILS ================= */
function cleanText(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/EasyChair.*?Log in/i, "")
    .replace(/User Guide.*?Watchlist/i, "")
    .trim();
}

/* ================= DATE PARSER ================= */
function parseDateToISO(text) {
  if (!text) return null;

  const months = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12"
  };

  const match = text.match(
    /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/
  );

  if (!match) return null;

  const month = months[match[1].toLowerCase()];
  const day = match[2].padStart(2, "0");
  const year = match[3];

  if (!month) return null;

  return `${year}-${month}-${day}`;
}

/* ================= DEADLINE ================= */
function extractDeadline(text) {
  const match = text.match(
    /(deadline|due|submission).*?([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i
  );

  if (!match) return null;

  return parseDateToISO(match[2]);
}

/* ================= LINK ================= */
function cleanLink(link) {
  if (!link) return null;

  const match = link.match(/https?:\/\/[^\s"]+/);
  if (!match) return null;

  let clean = match[0];

  const confMatch = clean.match(/conf=[a-zA-Z0-9_-]+/);

  if (confMatch) {
    return `https://easychair.org/conferences/?${confMatch[0]}`;
  }

  return clean;
}

/* ================= TOPICS ================= */
function extractTopics(text) {
  const topicMatch = text.match(/theme:(.*?)(\.|\n)/i);

  if (!topicMatch) return [];

  return topicMatch[1]
    .split(/,|—|-/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/* ================= RULE PARSER ================= */
function parseEasyChair(html) {
  const $ = cheerio.load(html);

  $("script, style, nav, footer, header").remove();

  const bodyText = cleanText($("body").text());

  let cfp_text = "";

  $("p, h1, h2, h3").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 80) {
      cfp_text += t + "\n";
    }
  });

  cfp_text = cleanText(cfp_text);

  // 🔥 tránh bị cắt quá sớm
  if (cfp_text.length > 20000) {
    cfp_text = cfp_text.slice(0, 20000);
  }

  let submission_link = null;

  $("a").each((_, el) => {
    const href = $(el).attr("href");

    if (!submission_link && href && href.includes("conf=")) {
      submission_link = cleanLink(href);
    }
  });

  const deadline = extractDeadline(bodyText);
  const topics = extractTopics(bodyText);

  return {
    cfp_text,
    submission_link,
    deadline,
    topics,
  };
}

/* ================= OLLAMA ================= */
async function callOllama(text) {
  try {
    const res = await axios.post(
      OLLAMA_URL,
      {
        model: MODEL,
        prompt: `
Extract JSON:
{
  cfp_text,
  deadline (YYYY-MM-DD),
  topics (array)
}

Text:
${text.slice(0, 8000)}
        `,
        stream: false,
      },
      { timeout: TIMEOUT }
    );

    const raw = res.data?.response;

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.log("❌ OLLAMA error → fallback");
    return null;
  }
}

/* ================= MAIN ================= */
async function run() {
  console.log("🚀 AI Enrich FULL (ISO deadline + parser)...");

  const db = await getDb();
  const col = db.collection("conference");

  const docs = await col
    .find({
      $or: [
        { cfp_text: { $exists: false } },
        { cfp_text: "" },
      ],
    })
    .limit(5000)
    .toArray();

  const queue = new PQueue({ concurrency: CONCURRENCY });

  let count = 0;

  for (const doc of docs) {
    queue.add(async () => {
      try {
        console.log("🌐 Fetch:", doc.url);

        const res = await axios.get(doc.url, {
          timeout: TIMEOUT,
        });

        const html = res.data;

        let data = parseEasyChair(html);

        if (data.cfp_text && data.cfp_text.length > 500) {
          console.log("⚡ Rule parser OK");
        } else {
          console.log("🤖 Using AI...");

          const ai = await callOllama(html);

          if (ai) {
            data = { ...data, ...ai };
          }
        }

        data.cfp_text = cleanText(data.cfp_text || "");

        await col.updateOne(
          { _id: doc._id },
          {
            $set: {
              ...data,
              status: "done",
              updated_time: new Date().toISOString(),
            },
          }
        );

        count++;
        console.log(`✅ Done: ${count}`);
      } catch (err) {
        console.log("❌ Failed:", doc.url);
      }
    });
  }

  await queue.onIdle();

  console.log("🎯 DONE CFP ENRICH");
  process.exit(0);
}

run();