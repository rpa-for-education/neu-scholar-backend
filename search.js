// search.js
import axios from "axios";
import { QdrantClient } from "@qdrant/js-client-rest";
import {
  detectDomain,
  analyzeQuestion,
  finalizeResults
} from "./agentReasoning.js";

import "dotenv/config";

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const COLLECTION = "neu-scholar";

const EMBEDDING_API = "https://research.neu.edu.vn/ollama/api/embed";

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY,
});

// ================= EMBED =================
export async function embedText(text) {
  try {
    const res = await axios.post(EMBEDDING_API, {
      model: "qwen3-embedding:8b",
      input: text,
    });
    return res.data?.embeddings?.[0] || null;
  } catch {
    return null;
  }
}

// ================= HYBRID SCORE =================
function semanticScore(text, query, baseScore) {
  if (!text) return baseScore;

  const words = query.toLowerCase().split(/\s+/);
  const t = text.toLowerCase();

  let match = 0;
  for (const w of words) {
    if (t.includes(w)) match++;
  }

  return baseScore * 0.7 + (match / words.length) * 0.3;
}

// ================= ACADEMIC BOOST =================
function academicBoost(item, analysis) {
  let score = item.score || 0;

  // 🔥 Q1 boost
  if (item.quartile === "Q1") score += 0.3;
  if (item.quartile === "Q2") score += 0.15;

  // 🔥 Impact boost
  if (item.h_index > 100) score += 0.2;
  if (item.sjr > 2) score += 0.2;

  // 🔥 Recommendation intent
  if (analysis.wantsRecommendation) {
    if (item.quartile === "Q1") score += 0.2;
  }

  return score;
}

// ================= FILTER =================
function applyAcademicFilter(conferences, journals, analysis) {
  // ===== JOURNAL =====
  if (analysis.wantsQuartile) {
    journals = journals.filter(j =>
      ["Q1", "Q2"].includes((j.quartile || "").toUpperCase())
    );
  }

  // ===== FIELD =====
  if (analysis.fieldHint) {
    const f = analysis.fieldHint.toLowerCase();

    journals = journals.filter(j =>
      (j.areas || "").toLowerCase().includes(f) ||
      (j.categories || "").toLowerCase().includes(f)
    );

    conferences = conferences.filter(c =>
      (c.topics || "").toLowerCase().includes(f)
    );
  }

  // ===== YEAR =====
  if (analysis.wantsRecent) {
    const year = Number(analysis.wantsRecent[0]);

    conferences = conferences.filter(c =>
      Number(c.year) === year
    );
  }

  // ===== COUNTRY =====
  if (analysis.wantsCountryCode) {
    const code = analysis.wantsCountryCode.toLowerCase();

    conferences = conferences.filter(c =>
      (c.country || "").toLowerCase().includes(code)
    );

    journals = journals.filter(j =>
      (j.country || "").toLowerCase().includes(code)
    );
  }

  // ===== CONTINENT =====
  if (analysis.wantsContinent) {
    const cont = analysis.wantsContinent.toLowerCase();

    conferences = conferences.filter(c =>
      (c.continent || "").toLowerCase().includes(cont)
    );
  }

  return { conferences, journals };
}

// ================= SORT =================
function rankAcademic(items, type = "journal") {
  if (type === "journal") {
    return items.sort((a, b) => {
      return (
        (b.score || 0) - (a.score || 0) ||
        (b.h_index || 0) - (a.h_index || 0) ||
        (b.sjr || 0) - (a.sjr || 0)
      );
    });
  }

  // conference
  return items.sort((a, b) => {
    const dA = new Date(a.deadline || "2100");
    const dB = new Date(b.deadline || "2100");

    return dA - dB; // deadline gần trước
  });
}

// ================= MAIN =================
export async function searchConferenceJournalByVector({
  question,
  topk = 10,
}) {
  try {
    if (!question) {
      return { conferences: [], journals: [], domain: "empty" };
    }

    const domain = detectDomain(question);
    const analysis = analyzeQuestion(question);

    const vector = await embedText(question);

    const raw = await qdrant.search(COLLECTION, {
      vector,
      limit: topk * 5,
      with_payload: true,
    });

    let conferences = [];
    let journals = [];

    for (const r of raw) {
      const p = r.payload || {};

      const base = {
        ...p,
        score: semanticScore(p.text, question, r.score),
      };

      // 🔥 detect type
      if (p.type === "conference" || p.name) {
        conferences.push(base);
      } else if (p.type === "journal" || p.title) {
        journals.push(base);
      }
    }

    // ================= FILTER =================
    ({ conferences, journals } = applyAcademicFilter(
      conferences,
      journals,
      analysis
    ));

    // ================= BOOST =================
    journals = journals.map(j => ({
      ...j,
      score: academicBoost(j, analysis),
    }));

    // ================= RANK =================
    journals = rankAcademic(journals, "journal");
    conferences = rankAcademic(conferences, "conference");

    return {
      domain,
      analysis,
      conferences: finalizeResults(conferences, topk),
      journals: finalizeResults(journals, topk),
    };

  } catch (err) {
    console.error("❌ Search error:", err);

    return {
      conferences: [],
      journals: [],
      domain: "error"
    };
  }
}