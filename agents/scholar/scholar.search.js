import axios from "axios";
import { QdrantClient } from "@qdrant/js-client-rest";
import {
  detectDomain,
  analyzeQuestion,
  finalizeResults,
  applyFilters
} from "./agentReasoning.js";

import { getDb } from "../../db/mongo.js";
import { expandQuery } from "./scholar.queryExpansion.js";

import "dotenv/config";

// ================= CONFIG =================
const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const COLLECTION = "neu-scholar";

const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434").replace(/\/$/, "");
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "qwen3-embedding:8b";

const VECTOR_SIZE = 4096;

// ================= INIT =================
const qdrant = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY,
  checkCompatibility: false,
});

// ================= EMBED =================
export async function embedText(text, retry = 2) {
  try {
    const res = await axios.post(`${OLLAMA_BASE}/api/embed`, {
      model: OLLAMA_EMBED_MODEL,
      input: text,
    });

    const vec = res.data?.embeddings?.[0];

    if (!vec || vec.length !== VECTOR_SIZE) {
      throw new Error("Invalid embedding");
    }

    return vec;

  } catch (err) {
    if (retry > 0) {
      await new Promise(r => setTimeout(r, 800));
      return embedText(text, retry - 1);
    }

    console.error("❌ Embedding error:", err.message);
    return null;
  }
}

// ================= SAFE DATE =================
function getDate(item) {
  return item.deadline || item.start_date || "";
}

// ================= KEYWORD SCORE =================
function keywordMatchScore(text, query) {
  if (!text) return 0;

  const words = query.toLowerCase().split(/\s+/);
  const t = text.toLowerCase();

  let score = 0;
  for (const w of words) {
    if (t.includes(w)) score++;
  }

  return score / words.length;
}

// ================= INTENT BOOST =================
function intentBoost(item, analysis) {
  let boost = 0;

  if (analysis.wantsRanking && item.sjr_best_quartile === "Q1") {
    boost += 0.3;
  }

  if (analysis.wantsDeadline && getDate(item)) {
    boost += 0.2;
  }

  if (analysis.fieldHint) {
    const f = analysis.fieldHint.toLowerCase();
    const text = (
      item.topics ||
      item.categories ||
      item.areas ||
      ""
    ).toLowerCase();

    if (text.includes(f)) boost += 0.4;
  }

  if (analysis.wantsCountryCode && item.country_code === analysis.wantsCountryCode) {
    boost += 0.4;
  }

  return boost;
}

// ================= SAFE FILTER =================
function safeApplyFilters(items, analysis, domain) {
  try {
    const filtered = applyFilters(items, analysis, domain);

    // 👉 fallback nếu filter làm rỗng
    if (!filtered || filtered.length === 0) {
      console.warn("⚠️ Filter removed all → fallback to original");
      return items;
    }

    return filtered;
  } catch (err) {
    console.warn("⚠️ Filter error → fallback:", err.message);
    return items;
  }
}

// ================= MAIN =================
export async function searchConferenceJournalByVector({
  question,
  topk = 10,
}) {
  try {
    const domain = detectDomain(question);
    const analysis = analyzeQuestion(question);

    console.log("🧠 Query:", question);
    console.log("🧠 Analysis:", analysis);

    // ================= MULTI QUERY =================
    const queries = await expandQuery(question);

    let allResults = [];

    for (const q of queries) {
      const vector = await embedText(q);
      if (!vector) continue;

      try {
        const raw = await qdrant.search(COLLECTION, {
          vector,
          limit: topk * 3,
          with_payload: true,
        });

        allResults.push(...raw);
      } catch (err) {
        console.error("❌ Qdrant error:", err.message);
      }
    }

    console.log("🔍 RAW Qdrant:", allResults.length);

    let conferences = [];
    let journals = [];

    // ================= VECTOR =================
    for (const r of allResults) {
      const p = r.payload || {};

      const item = {
        ...p,
        score: (r.score || 0) + intentBoost(p, analysis),
      };

      if (p.type === "conference" || p.name) {
        conferences.push(item);
      } else if (p.type === "journal" || p.title) {
        journals.push(item);
      }
    }

    console.log("📦 Vector split:", conferences.length, journals.length);

    // ================= HYBRID (Mongo) =================
    try {
      const db = await getDb();

      // 👉 regex mềm hơn (không dùng full query)
      const keyword = question.split(" ").slice(0, 3).join(" ");
      const regex = new RegExp(keyword, "i");

      const mongoConfs = await db.collection("conference")
        .find({ name: regex })
        .limit(10)
        .toArray();

      const mongoJournals = await db.collection("journal")
        .find({ title: regex })
        .limit(10)
        .toArray();

      console.log("📦 Mongo:", mongoConfs.length, mongoJournals.length);

      conferences = [
        ...conferences,
        ...mongoConfs.map(c => ({
          ...c,
          score:
            keywordMatchScore(c.name + " " + (c.topics || ""), question) +
            intentBoost(c, analysis),
        }))
      ];

      journals = [
        ...journals,
        ...mongoJournals.map(j => ({
          ...j,
          score:
            keywordMatchScore(j.title + " " + (j.categories || ""), question) +
            intentBoost(j, analysis),
        }))
      ];

    } catch (err) {
      console.warn("⚠️ Mongo fallback failed:", err.message);
    }

    console.log("📊 Before filter:", conferences.length, journals.length);

    // ================= SAFE FILTER =================
    conferences = safeApplyFilters(conferences, analysis, "conference");
    journals = safeApplyFilters(journals, analysis, "journal");

    console.log("📊 After filter:", conferences.length, journals.length);

    return {
      domain,
      analysis,
      conferences: finalizeResults(conferences, topk * 2),
      journals: finalizeResults(journals, topk * 2),
    };

  } catch (err) {
    console.error("❌ Search fatal:", err);

    return {
      conferences: [],
      journals: [],
      domain: "error"
    };
  }
}