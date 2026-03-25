import axios from "axios";
import { qdrantClient as qdrant } from "../../db/qdrant.js";
import {
  detectDomain,
  analyzeQuestion
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
    .replace(/\s+/g, " ")
    .trim();
}

// ================= VI → EN =================
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

// ================= DEDUPE =================
function dedupe(items) {
  const map = new Map();

  for (const it of items) {
    const key = (it.title || it.name || "").toLowerCase();
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, it);
    }
  }

  return [...map.values()];
}

// ================= TYPE DETECT =================
function isConference(i) {
  return (
    i.type === "conference" ||
    i.acronym ||
    i.cfp_text ||
    i.deadline ||
    i.start_date
  );
}

function isJournal(i) {
  return (
    i.type === "journal" ||
    i.sjr_best_quartile ||
    i.publisher
  );
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

    const collections =
      domain === "conference"
        ? ["conference_vectors"]
        : domain === "journal"
        ? ["journal_vectors"]
        : ["conference_vectors", "journal_vectors"];

    const queries = [question, cleaned, semantic];

    let results = [];

    // ================= SEARCH =================
    for (const col of collections) {
      for (const q of queries) {
        try {
          const vector = await embed(q);
          if (!vector) continue;

          const res = await qdrant.search(col, {
            vector,
            limit: topk * 5,
            with_payload: true,
          });

          results.push(
            ...res.map(r => ({
              ...r.payload,
              _score: r.score
            }))
          );

        } catch (err) {
          console.warn(`⚠️ skip ${col}:`, err.message);
        }
      }
    }

    console.log("📊 Raw results:", results.length);

    // ================= NO DATA =================
    if (!results.length) {
      return {
        domain,
        conferences: [],
        journals: [],
      };
    }

    // ================= FILTER =================
    if (analysis.wantsCountryCode) {
      const filtered = results.filter(
        i => i.country_code === analysis.wantsCountryCode
      );

      if (filtered.length) {
        results = filtered;
      } else {
        console.warn("⚠️ filter removed all → fallback");
      }
    }

    console.log("📊 After filter:", results.length);

    // ================= DEDUPE =================
    results = dedupe(results);

    // ================= SCORE =================
    results = results.map(i => ({
      ...i,
      score: i._score ?? 0.3
    }));

    results.sort((a, b) => b.score - a.score);

    // 🔥 lấy nhiều hơn để agent còn rank
    const final = results.slice(0, topk * 3);

    console.log("📦 FINAL ITEMS:", final.length);

    // ================= SPLIT =================
    const conferences = [];
    const journals = [];

    for (const i of final) {
      if (isConference(i)) {
        conferences.push(i);
      } else if (isJournal(i)) {
        journals.push(i);
      }
    }

    console.log("📊 SPLIT:", conferences.length, journals.length);

    // 🔥 KHÔNG dùng finalizeResults nữa (BUG)
    const finalConfs = conferences.slice(0, topk);
    const finalJournals = journals.slice(0, topk);

    console.log("🚀 RETURN:", finalConfs.length, finalJournals.length);

    return {
      domain,
      conferences: finalConfs,
      journals: finalJournals,
    };

  } catch (err) {
    console.error("❌ search fatal:", err);

    return {
      conferences: [],
      journals: [],
    };
  }
}