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
    console.warn("⚠️ embed fail:", err.message);
    return null;
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

// ================= LLM RERANK =================
async function rerankWithLLM(query, items) {
  if (!items.length) return [];

  const prompt = `
Bạn là AI chọn hội thảo/tạp chí phù hợp nhất.

Query: "${query}"

Danh sách:
${items.map((i, idx) => `${idx + 1}. ${i.title || i.name}`).join("\n")}

Chọn ra top 5 phù hợp nhất (chỉ trả về số).
`;

  try {
    const res = await axios.post(`${OLLAMA_BASE}/api/generate`, {
      model: LLM_MODEL,
      prompt,
      stream: false,
    });

    const text = res.data.response || "";
    const picks = text.match(/\d+/g)?.map(Number) || [];

    return picks
      .map(i => items[i - 1])
      .filter(Boolean);

  } catch (err) {
    console.warn("⚠️ rerank fail:", err.message);
    return items.slice(0, 5);
  }
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
    const collections =
      domain === "conference"
        ? ["conference_vectors"]
        : domain === "journal"
        ? ["journal_vectors"]
        : ["conference_vectors", "journal_vectors"];

    // ================= MULTI QUERY =================
    const queries = [
      question,
      cleaned,
      ...(await expandQuery(question))
    ];

    const uniqueQueries = [...new Set(queries)];

    let results = [];

    // ================= SEARCH =================
    for (const col of collections) {
      for (const q of uniqueQueries) {
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
          console.warn("⚠️ qdrant error:", err.message);
        }
      }
    }

    // ================= FILTER =================
    results = applyFilters(results, analysis, domain);

    // ================= RANK =================
    results = results.map(i => {
      const text = i.text || i.cfp_text || "";

      return {
        ...i,
        score:
          (i._score || 0.5) * 0.6 +
          keywordScore(text, cleaned) * 0.3
      };
    });

    results.sort((a, b) => b.score - a.score);

    // ================= RERANK =================
    const reranked = await rerankWithLLM(cleaned, results.slice(0, 15));

    // ================= HIGHLIGHT =================
    const final = reranked.map(i => ({
      ...i,
      highlight: highlight(i.text || i.cfp_text || "", cleaned)
    }));

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
      analysis,
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