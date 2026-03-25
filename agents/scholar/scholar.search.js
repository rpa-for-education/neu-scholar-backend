import axios from "axios";
import { qdrantClient as qdrant } from "../../db/qdrant.js";
import {
  detectDomain,
  analyzeQuestion,
  finalizeResults,
  applyFilters
} from "./agentReasoning.js";

import "dotenv/config";

// ================= CONFIG =================
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const EMBED_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "qwen3-embedding:8b";

// ================= CLEAN =================
function cleanQuery(q) {
  return q
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

// ================= 🔥 VI → EN =================
function normalizeSemantic(q) {
  return q
    .toLowerCase()
    .replace(/trung quốc/g, "china")
    .replace(/việt nam/g, "vietnam")
    .replace(/hội thảo/g, "conference")
    .replace(/quốc tế/g, "international")
    .replace(/tạp chí/g, "journal");
}

// ================= EMBED =================
async function embed(text) {
  try {
    const res = await axios.post(`${OLLAMA_BASE}/api/embed`, {
      model: EMBED_MODEL,
      input: text,
    });
    return res.data?.embeddings?.[0];
  } catch (err) {
    console.error("❌ embed error:", err.message);
    return null;
  }
}

// ================= MAIN =================
export async function searchConferenceJournalByVector({
  question,
  topk = 10,
}) {
  try {
    console.log("🧠 Query:", question);

    const cleaned = cleanQuery(question);
    const semantic = normalizeSemantic(question);

    const domain = detectDomain(question);
    const analysis = analyzeQuestion(question);

    let collections =
      domain === "conference"
        ? ["conference_vectors"]
        : domain === "journal"
        ? ["journal_vectors"]
        : ["conference_vectors", "journal_vectors"];

    // ================= QUERY =================
    const queries = [
      question,
      cleaned,
      semantic
    ];

    let results = [];

    // ================= SEARCH =================
    for (const col of collections) {
      try {
        for (const q of queries) {
          const vector = await embed(q);
          if (!vector) continue;

          const res = await qdrant.search(col, {
            vector,
            limit: topk * 5,
            with_payload: true,
          });

          results.push(...res.map(r => ({
            ...r.payload,
            _score: r.score
          })));
        }
      } catch (err) {
        console.warn(`⚠️ skip collection ${col}:`, err.message);
      }
    }

    console.log("📊 Raw results:", results.length);

    // ================= STOP BỊA =================
    if (!results.length) {
      console.warn("⚠️ NO DATA FROM QDRANT");

      return {
        domain,
        conferences: [],
        journals: [],
      };
    }

    // ================= FILTER SAFE =================
    if (analysis.wantsCountryCode) {
      const filtered = results.filter(i =>
        i.country_code === analysis.wantsCountryCode
      );

      if (filtered.length) {
        results = filtered;
      } else {
        console.warn("⚠️ filter removed all → fallback");
      }
    }

    console.log("📊 After filter:", results.length);

    // ================= RANK =================
    results = results.map(i => {
      const text = [
        i.title,
        i.country,
        i.city,
        i.text
      ].join(" ");

      return {
        ...i,
        score: i._score || 0.5
      };
    });

    results.sort((a, b) => b.score - a.score);

    const final = results.slice(0, topk);

    const conferences = [];
    const journals = [];

    for (const i of final) {
      if (i.type === "conference" || i.acronym) {
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
    console.error("❌ search fatal:", err);

    return {
      conferences: [],
      journals: [],
    };
  }
}