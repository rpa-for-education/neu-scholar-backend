import axios from "axios";
import { QDRANT_CLIENT as qdrant } from "../../db/qdrant.js";
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
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL;
const EMBED_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "qwen3-embedding:8b";
const LLM_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";

// ================= CACHE =================
const CACHE = new Map();

// ================= CLEAN QUERY =================
function cleanQuery(q) {
  return q
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\b(tại|ở|về|cho|các|những)\b/g, "")
    .trim();
}

// ================= EMBED =================
async function embed(text) {
  if (CACHE.has("embed:" + text)) return CACHE.get("embed:" + text);

  const res = await axios.post(`${OLLAMA_BASE}/api/embed`, {
    model: EMBED_MODEL,
    input: text,
  });

  const vec = res.data?.embeddings?.[0];
  CACHE.set("embed:" + text, vec);

  return vec;
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
  const prompt = `
Bạn là AI chọn hội thảo/tạp chí phù hợp nhất.

Query: "${query}"

Danh sách:
${items.map((i, idx) => `${idx + 1}. ${i.title}`).join("\n")}

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

  } catch {
    return items.slice(0, 5);
  }
}

// ================= MAIN =================
export async function searchConferenceJournalByVector({
  question,
  topk = 10,
}) {
  const cleaned = cleanQuery(question);

  const domain = detectDomain(question);
  const analysis = analyzeQuestion(question);

  console.log("🧠 Query:", cleaned);

  let collections =
    domain === "conference"
      ? ["conference_vectors"]
      : domain === "journal"
      ? ["journal_vectors"]
      : ["conference_vectors", "journal_vectors"];

  const queries = await expandQuery(cleaned);

  let results = [];

  for (const col of collections) {
    for (const q of queries) {
      const vector = await embed(q);

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
  }

  // ================= FILTER =================
  results = applyFilters(results, analysis, domain);

  // ================= RANK =================
  results = results.map(i => {
    const text = i.text || i.cfp_text || "";

    return {
      ...i,
      score:
        i._score * 0.6 +
        keywordScore(text, cleaned) * 0.3
    };
  });

  results.sort((a, b) => b.score - a.score);

  // ================= LLM RERANK =================
  const reranked = await rerankWithLLM(cleaned, results.slice(0, 15));

  // ================= HIGHLIGHT =================
  const final = reranked.map(i => ({
    ...i,
    highlight: highlight(i.text || "", cleaned)
  }));

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
}