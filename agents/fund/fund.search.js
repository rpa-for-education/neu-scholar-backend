// fund.search.js
import { embed } from "../shared/embedding.js";
import { qdrantClient } from "../../db/qdrant.js";

const COLLECTION =
  process.env.QDRANT_COLLECTION_FUND || "fund_vectors";

const CACHE_TTL = 1000 * 60 * 5;
const EMBED_TTL = 1000 * 60 * 30;
const TIMEOUT = 1500;

const CACHE_VERSION = "v3";

const CACHE = new Map();
const EMBED_CACHE = new Map();
const MAX_EMBED_CACHE = 200;

// ================= CACHE =================
function getCache(map, key, ttl) {
  const item = map.get(key);
  if (!item) return null;

  if (Date.now() - item.time > ttl) {
    map.delete(key);
    return null;
  }

  // 🔥 LRU
  map.delete(key);
  map.set(key, item);

  return item.value;
}

function setCache(map, key, value, maxSize = 500) {
  if (map.size >= maxSize) {
    const firstKey = map.keys().next().value;
    map.delete(firstKey);
  }

  map.set(key, {
    time: Date.now(),
    value,
  });
}

// ================= UTILS =================
function normalizeQuery(query) {
  return (query || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function cleanQueryForEmbed(q) {
  return q.replace(/20\d{2}/g, "").trim();
}

function safeTopk(topk) {
  const n = Number(topk);
  return n && n > 0 ? n : 5;
}

function extractYear(query) {
  const m = query.match(/20\d{2}/);
  return m ? Number(m[0]) : null;
}

function withTimeout(promise, ms = TIMEOUT) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

// ================= FILTER =================
function buildFilter(year) {
  const now = Date.now();

  if (year) {
    const start = new Date(`${year}-01-01`).getTime();
    const end = new Date(`${year}-12-31`).getTime();

    return {
      must: [
        {
          key: "deadline_ts",
          range: {
            gte: Math.max(now, start),
            lte: end,
          },
        },
      ],
    };
  }

  return {
    must: [
      {
        key: "deadline_ts",
        range: { gte: now },
      },
    ],
  };
}

// ================= SAFE KEY =================
function buildKey(r) {
  return (
    r.id ||
    `${r.payload?.title || ""}_${r.payload?.agency || ""}_${r.payload?.deadline || ""}`
  );
}

// ================= MAIN =================
export async function searchFund(query, topk = 5) {
  try {
    const normalized = normalizeQuery(query);

    // 🔥 guard query rác
    if (!normalized || normalized.length < 2) return [];

    const limit = safeTopk(topk);
    const year = extractYear(normalized);

    const cacheKey = `${CACHE_VERSION}:fund:${normalized}:${limit}:${year || "all"}`;

    const cached = getCache(CACHE, cacheKey, CACHE_TTL);
    if (cached) return cached;

    // ================= EMBED =================
    const embedQuery = cleanQueryForEmbed(normalized);

    // 🔥 tránh embed rỗng (VD: chỉ có "2025")
    if (!embedQuery) return [];

    let vector = getCache(EMBED_CACHE, embedQuery, EMBED_TTL);

    if (!vector) {
      vector = await withTimeout(embed(embedQuery), 1200).catch(() => null);
      if (!vector || !Array.isArray(vector)) return [];

      setCache(EMBED_CACHE, embedQuery, vector, MAX_EMBED_CACHE);
    }

    const filter = buildFilter(year);

    // ================= SEARCH =================
    const result = await withTimeout(
      qdrantClient.search(COLLECTION, {
        vector,
        limit: limit * 2,
        with_payload: true,
        with_vector: false,
        score_threshold: 0.2,
        filter,
      }),
      TIMEOUT
    ).catch(() => []);

    // ================= NORMALIZE + DEDUP =================
    const map = new Map();

    for (const r of result || []) {
      if (!r || !r.payload) continue;

      const key = buildKey(r);
      if (!key) continue;

      if (!map.has(key)) {
        map.set(key, {
          ...r,
          score: typeof r.score === "number" ? r.score : 0,
        });
      }
    }

    const finalResult = Array.from(map.values()).slice(0, limit);

    setCache(CACHE, cacheKey, finalResult);

    return finalResult;

  } catch (err) {
    console.error("❌ searchFund error:", err.message);
    return [];
  }
}