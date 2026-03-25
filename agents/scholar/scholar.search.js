import axios from "axios";
import { qdrantClient as qdrant } from "../../db/qdrant.js";
import {
  detectDomain,
  analyzeQuestion,
  finalizeResults,
  applyFilters
} from "./agentReasoning.js";

import { expandQuery } from "./scholar.queryExpansion.js";
import "dotenv/config";

// ================= CONFIG =================
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const EMBED_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "qwen3-embedding:8b";
const LLM_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";

// ================= CACHE =================
const CACHE = new Map();

// ================= CLEAN QUERY =================
function cleanQuery(q) {
  return q
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ================= EMBED =================
async function embed(text) {
  const key = "embed:" + text;

  if (CACHE.has(key)) return CACHE.get(key);

  try {
    const res = await axios.post(`${OLLAMA_BASE}/api/embed`, {
      model: EMBED_MODEL,
      input: text,
    });

    const vec = res.data?.embeddings?.[0];
    if (vec) CACHE.set(key, vec);

    return vec;

  } catch (err) {
    console.error("❌ embed fail:", err.message);
    return null;
  }
}

// ================= CHECK COLLECTION =================
async function collectionExists(name) {
  try {
    await qdrant.getCollection(name);
    return true;
  } catch {
    console.warn(`⚠️ Collection not found: ${name}`);
    return false;
  }
}

// ================= KEYWORD SCORE =================
function keywordScore(text, query) {
  if (!text) return 0;

  const words = query.split(/\s+/);
  let hit = 0;

  for (const w of words) {
    if (text.toLowerCase().includes(w)) hit++;
  }

  return hit / words.length;
}

// ================= HIGHLIGHT =================
function highlight(text, query) {
  if (!text) return "";

  let result = text;

  for (const w of query.split(/\s+/)) {
    if (w.length < 3) continue;

    const regex = new RegExp(`(${w})`, "gi");
    result = result.replace(regex, "**$1**");
  }

  return result.slice(0, 300);
}

// ================= MAIN =================
export async function searchConferenceJournalByVector({
  question,
  topk = 10,
}) {
  try {
    const cleaned = cleanQuery(question);

    const domain = detectDomain(question);
    const analysis = analyzeQuestion(question);

    console.log("🧠 Query:", question);

    // ================= COLLECTION =================
    let collections =
      domain === "conference"
        ? ["conference_vectors"]
        : domain === "journal"
        ? ["journal_vectors"]
        : ["conference_vectors", "journal_vectors"];

    // 🔥 FILTER COLLECTION EXISTS
    const validCollections = [];

    for (const col of collections) {
      if (await collectionExists(col)) {
        validCollections.push(col);
      }
    }

    if (!validCollections.length) {
      console.error("❌ No valid collections found");
      return {
        domain,
        conferences: [],
        journals: [],
      };
    }

    // ================= QUERY =================
    const queries = [
      question,
      cleaned
    ];

    let results = [];

    // ================= SEARCH =================
    for (const col of validCollections) {
      for (const q of queries) {
        const vector = await embed(q);
        if (!vector) continue;

        try {
          const res = await qdrant.search(col, {
            vector,
            limit: topk * 5,
            with_payload: true,
          });

          results.push(...res.map(r => ({
            ...r.payload,
            _score: r.score
          })));

        } catch (err) {
          console.error(`❌ Qdrant search failed (${col}):`, err.message);
        }
      }
    }

    // ================= NO RESULT =================
    if (!results.length) {
      console.warn("⚠️ No data from Qdrant");
      return {
        domain,
        conferences: [],
        journals: [],
      };
    }

    // ================= FILTER =================
    results = applyFilters(results, analysis, domain);

    // ================= RANK =================
    results = results.map(i => {
      const text = i.text || i.cfp_text || "";

      return {
        ...i,
        score:
          (i._score || 0.5) * 0.7 +
          keywordScore(text, cleaned) * 0.3
      };
    });

    results.sort((a, b) => b.score - a.score);

    const final = results.slice(0, topk);

    // ================= SPLIT =================
    const conferences = [];
    const journals = [];

    for (const i of final) {
      if (i.type === "conference" || i.acronym || i.start_date) {
        conferences.push(i);
      } else {
        journals.push(i);
      }
    }

    return {
      domain,
      conferences: finalizeResults(conferences, topk),
      journals: finalizeResults(journals, topk),
    };

  } catch (err) {
    console.error("❌ search error:", err);

    return {
      conferences: [],
      journals: [],
      domain: "error"
    };
  }
}