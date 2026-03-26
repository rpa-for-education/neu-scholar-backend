// fund.search.js - Tìm kiếm quỹ đầu tư bằng vector embedding
import { embed } from "../shared/embedding.js";
import { qdrantClient } from "../../db/qdrant.js";

const COLLECTION =
  process.env.QDRANT_COLLECTION_FUND || "fund_vectors";

const CACHE_TTL = 1000 * 60 * 5;
const TIMEOUT = 1200; // 🔥 giảm mạnh
const MAX_RETRIES = 0;

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

function normalizeQuery(query) {
  return (query || "").trim().toLowerCase();
}

function safeTopk(topk) {
  const n = Number(topk);
  return n && n > 0 ? n : 5;
}

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

    const cached = getCache(cacheKey);
    if (cached) return cached;

    // 🔥 embed nhanh hơn
    const vector = await withTimeout(embed(normalized), 1000).catch(() => null);

    if (!vector) return [];

    const result = await withTimeout(
      qdrantClient.search(COLLECTION, {
        vector,
        limit,
        with_payload: true,
      }),
      TIMEOUT
    ).catch(() => []);

    const finalResult = result || [];

    setCache(cacheKey, finalResult);

    return finalResult;

  } catch (err) {
    console.error("❌ searchFund error:", err.message);
    return [];
  }
}