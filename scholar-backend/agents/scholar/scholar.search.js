// scholar.search.js
import { qdrantClient as qdrant } from "../../db/qdrant.js";
import {
  detectDomain,
  analyzeQuestion
} from "./agentReasoning.js";

import { embedBatch } from "../shared/embedding.js";

import "dotenv/config";

const MAX_LIMIT = 20;

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

// ================= NORMALIZE =================
function normalizeText(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

// ================= COUNTRY =================
function normalizeCountry(c) {
  const map = {
    vn: "vietnam",
    usa: "united states",
    us: "united states"
  };

  const n = normalizeText(c);
  return map[n] || n;
}

// ================= DEDUPE =================
function normalizeKey(text) {
  return normalizeText(text).replace(/\d{4}/g, "");
}

function dedupe(items) {
  const map = new Map();

  for (const it of items) {
    const key = normalizeKey(it.title || it.name);
    if (!key) continue;
    if (!map.has(key)) map.set(key, it);
  }

  return [...map.values()];
}

// ================= TYPE =================
function isConference(i) {
  return (
    i.type === "conference" ||
    !!i.deadline ||
    !!i.start_date ||
    !!i.acronym
  );
}

function isJournal(i) {
  return (
    i.type === "journal" ||
    !!i.sjr_best_quartile ||
    !!i.publisher
  );
}

// ================= SAFE DATE =================
function safeTime(d) {
  const t = new Date(d).getTime();
  return isNaN(t) ? null : t;
}

// ================= 🔥 FIELD MATCH (UPGRADE) =================
function fieldMatchScore(item, fieldHint) {
  const field = normalizeText(fieldHint);

  const text = normalizeText(
    item.text || item.topics || item.categories || ""
  );

  const fields = (item.fields || []).map(normalizeText);

  let score = 0;

  if (text.includes(field)) score += 0.3;

  for (const f of fields) {
    if (f.includes(field) || field.includes(f)) {
      score += 0.3;
    }
  }

  return score;
}

// ================= SCORE ENGINE =================
function computeFinalScore(item, analysis, baseScore) {
  let score = baseScore;

  const now = Date.now();
  const deadline = safeTime(item.deadline);

  // ===== FIELD =====
  if (analysis.fieldHint) {
    score += fieldMatchScore(item, analysis.fieldHint);
  }

  // ===== CFP LOGIC =====
  if (deadline) {
    const diff = (deadline - now) / (1000 * 60 * 60 * 24);

    if (diff > 0) {
      score += 0.5; // còn hạn (tăng mạnh)

      if (diff < 30) score += 0.4; // gần deadline

      // 🔥 PRIORITY: deadline càng gần càng cao
      score += Math.max(0, 1 - diff / 90);
    } else {
      score -= 0.5; // 🔥 giảm mạnh nếu hết hạn
    }
  }

  return score;
}

// ================= MAIN =================
export async function searchConferenceJournalByVector({
  question,
  topk = 10,
}) {
  try {
    const cacheKey = question.toLowerCase();

    const cached = QUERY_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.time < QUERY_TTL) {
      return cached.value;
    }

    const cleaned = cleanQuery(question);

    const domain = detectDomain(question);
    const analysis = analyzeQuestion(question);

    const collections =
      domain === "conference"
        ? ["conference_vectors"]
        : domain === "journal"
        ? ["journal_vectors"]
        : ["conference_vectors", "journal_vectors"];

    const vectors = await embedBatch([question, cleaned]);

    let results = [];

    const tasks = [];

    for (const col of collections) {
      for (let i = 0; i < vectors.length; i++) {
        const vector = vectors[i];
        if (!vector) continue;

        const weight = i === 0 ? 1 : 0.6;

        tasks.push(
          qdrant.search(col, {
            vector,
            limit: Math.min(topk * 3, MAX_LIMIT),
            with_payload: true,
          })
            .then(res =>
              res.map(r => ({
                ...r.payload,
                baseScore: r.score * weight
              }))
            )
            .catch(() => [])
        );
      }
    }

    results = (await Promise.all(tasks)).flat();

    if (!results.length) {
      return { domain, conferences: [], journals: [] };
    }

    // ================= COUNTRY FILTER =================
    if (analysis.wantsCountryCode) {
      const target = normalizeCountry(analysis.wantsCountryCode);

      const filtered = results.filter(i =>
        normalizeCountry(i.country).includes(target)
      );

      if (filtered.length > results.length * 0.3) {
        results = filtered;
      }
    }

    // ================= FINAL SCORE =================
    results = results.map(i => ({
      ...i,
      score: computeFinalScore(i, analysis, i.baseScore || 0)
    }));

    // ================= DEDUPE =================
    results = dedupe(results);

    // ================= SORT =================
    results.sort((a, b) => b.score - a.score);

    const final = results.slice(0, topk * 3);

    const conferences = [];
    const journals = [];

    for (const i of final) {
      if (isConference(i)) conferences.push(i);
      else if (isJournal(i)) journals.push(i);
    }

    const finalResult = {
      domain,
      conferences: conferences.slice(0, topk),
      journals: journals.slice(0, topk),
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