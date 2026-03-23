// agents/fund/fund.search.js

import { embed } from "../shared/embedding.js";
import { qdrantClient } from "../../db/qdrant.js";

// ================= CONFIG =================
const COLLECTION =
  process.env.QDRANT_COLLECTION_FUND || "fund_vectors";

const CACHE_TTL = 1000 * 60 * 5; // 5 phút
const MAX_RETRIES = 1;

// ================= CACHE =================
const CACHE = new Map();

function getCache(key) {
  const item = CACHE.get(key);
  if (!item) return null;

  if (Date.now() - item.time > CACHE_TTL) {
    CACHE.delete(key);
    return null;
  }

  return item.value;
}

function setCache(key, value) {
  CACHE.set(key, {
    time: Date.now(),
    value,
  });
}

// ================= UTILS =================
function normalizeQuery(query) {
  return (query || "").trim().toLowerCase();
}

function safeTopk(topk) {
  const n = Number(topk);
  return n && n > 0 ? n : 5;
}

// ================= MAIN =================
export async function searchFund(query, topk = 5) {
  try {
    const normalized = normalizeQuery(query);
    const limit = safeTopk(topk);

    const cacheKey = `fund:vector:${normalized}:${limit}`;

    // 🔥 CACHE HIT
    const cached = getCache(cacheKey);
    if (cached) return cached;

    // 🔥 EMBEDDING
    const vector = await embed(normalized);

    if (!vector) {
      console.warn("⚠️ No embedding → skip");
      return [];
    }

    let lastError;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await qdrantClient.search(COLLECTION, {
          vector,
          limit,
          with_payload: true,
        });

        const finalResult = result || [];

        // 🔥 CACHE SAVE
        setCache(cacheKey, finalResult);

        return finalResult;

      } catch (err) {
        lastError = err;

        console.warn(
          `⚠️ Qdrant search attempt ${attempt + 1} failed:`,
          err.message
        );
      }
    }

    console.error("❌ Qdrant search failed:", lastError?.message);

    return [];

  } catch (err) {
    console.error("❌ searchFund error:", err.message);
    return [];
  }
}