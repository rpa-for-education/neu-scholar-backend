import axios from "axios";
import { qdrantClient as qdrant } from "../../db/qdrant.js";
import {
  detectDomain,
  analyzeQuestion
} from "./agentReasoning.js";

import { embedBatch } from "../shared/embedding.js";

import "dotenv/config";

// ================= CONFIG =================
const MAX_LIMIT = 20;

// ================= CACHE =================
const QUERY_CACHE = new Map();
const QUERY_TTL = 1000 * 60 * 5;

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

    // ================= CACHE =================
    const cacheKey = question.toLowerCase();

    const cached = QUERY_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.time < QUERY_TTL) {
      console.log("⚡ CACHE HIT");
      return cached.value;
    }

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

    // ================= 🚀 BATCH EMBEDDING =================
    const vectors = await embedBatch(queries);

    let results = [];

    // ================= SEARCH =================
    const tasks = [];

    for (const col of collections) {
      for (let i = 0; i < vectors.length; i++) {
        const vector = vectors[i];
        if (!vector) continue;

        tasks.push(
          qdrant.search(col, {
            vector,
            limit: Math.min(topk * 3, MAX_LIMIT),
            with_payload: true,
          }).then(res =>
            res.map(r => ({
              ...r.payload,
              _score: r.score
            }))
          ).catch(err => {
            console.warn(`⚠️ skip ${col}:`, err.message);
            return [];
          })
        );
      }
    }

    const resultsArr = await Promise.all(tasks);
    results = resultsArr.flat();

    console.log("📊 Raw results:", results.length);

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

    const finalConfs = conferences.slice(0, topk);
    const finalJournals = journals.slice(0, topk);

    console.log("🚀 RETURN:", finalConfs.length, finalJournals.length);

    const finalResult = {
      domain,
      conferences: finalConfs,
      journals: finalJournals,
    };

    QUERY_CACHE.set(cacheKey, {
      value: finalResult,
      time: Date.now()
    });

    return finalResult;

  } catch (err) {
    console.error("❌ search fatal:", err);

    return {
      conferences: [],
      journals: [],
    };
  }
}