import { embed } from "../shared/embedding.js";
import { qdrantClient } from "../../db/qdrant.js";

// ================= CONFIG =================
const COLLECTION =
  process.env.QDRANT_COLLECTION_FUND || "fund_vectors";

const CACHE_TTL = 1000 * 60 * 5; // 5 phút
const MAX_RETRIES = 1;
const TIMEOUT = 2500; // 🔥 chống treo

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

// ================= 🔥 TIMEOUT WRAPPER =================
function withTimeout(promise, ms = TIMEOUT) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

// ================= MAIN =================
export async function searchFund(query, topk = 5) {
  try {
    const normalized = normalizeQuery(query);
    const limit = safeTopk(topk);

    const cacheKey = `fund:vector:${normalized}:${limit}`;

    // ================= CACHE HIT =================
    const cached = getCache(cacheKey);
    if (cached) {
      console.log("⚡ FUND CACHE HIT");
      return cached;
    }

    // ================= EMBEDDING =================
    const vector = await withTimeout(embed(normalized), 2000);

    if (!vector) {
      console.warn("⚠️ No embedding → skip");
      return [];
    }

    let lastError;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await withTimeout(
          qdrantClient.search(COLLECTION, {
            vector,
            limit,
            with_payload: true,
          }),
          TIMEOUT
        );

        const finalResult = result || [];

        // ================= CACHE SAVE =================
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

    // ================= FALLBACK =================
    return [];

  } catch (err) {
    console.error("❌ searchFund error:", err.message);

    return [];
  }
}