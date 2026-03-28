// ./shared/embedding.js

const TIMEOUT = 2500;
const MAX_RETRIES = 1;
const CACHE_TTL = 1000 * 60 * 30; // 30 phút

// ================= CACHE =================
const CACHE = new Map();
const INFLIGHT = new Map();

// ================= CACHE =================
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
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function normalizeText(text) {
  return text.trim().toLowerCase();
}

// ================= MODE =================
function getMode() {
  return process.env.EMBEDDING_MODE || "auto";
}

// ================= BUILD REQUEST =================
function buildRequest(input) {
  const base = process.env.OLLAMA_BASE_URL;
  const model = process.env.OLLAMA_EMBEDDING_MODEL;
  const mode = getMode();

  // 🔥 batch support
  const isBatch = Array.isArray(input);

  if (mode === "auto") {
    if (base.includes("/ollama")) {
      return {
        url: `${base}/api/embed`,
        body: {
          model,
          input: isBatch ? input : input,
        },
      };
    }

    return {
      url: `${base}/api/embeddings`,
      body: {
        model,
        prompt: isBatch ? input.join("\n") : input,
      },
    };
  }

  if (mode === "proxy") {
    return {
      url: `${base}/api/embed`,
      body: {
        model,
        input: isBatch ? input : input,
      },
    };
  }

  return {
    url: `${base}/api/embeddings`,
    body: {
      model,
      prompt: isBatch ? input.join("\n") : input,
    },
  };
}

// ================= PARSE =================
function parseEmbedding(data) {
  return (
    data?.embedding ||
    data?.data?.[0]?.embedding ||
    data?.embeddings?.[0] ||
    null
  );
}

// ================= SINGLE EMBED =================
export async function embed(text) {
  if (!text || !text.trim()) return null;

  const normalized = normalizeText(text);
  const cacheKey = `embed:${normalized}`;

  const cached = getCache(cacheKey);
  if (cached) return cached;

  if (INFLIGHT.has(cacheKey)) {
    return INFLIGHT.get(cacheKey);
  }

  const task = (async () => {
    const { url, body } = buildRequest(normalized);

    let lastError;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), TIMEOUT);

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(id);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        const vector = parseEmbedding(data);

        if (!vector || !Array.isArray(vector)) {
          throw new Error("Invalid embedding");
        }

        setCache(cacheKey, vector);

        return vector;

      } catch (err) {
        lastError = err;

        console.warn(
          `⚠️ Embedding attempt ${attempt + 1} failed:`,
          err.message
        );

        if (attempt < MAX_RETRIES) {
          await sleep(200);
        }
      }
    }

    console.error("❌ Embedding failed:", lastError?.message);

    return null;
  })();

  INFLIGHT.set(cacheKey, task);

  try {
    return await task;
  } finally {
    INFLIGHT.delete(cacheKey);
  }
}

// ================= 🚀 BATCH EMBED =================
export async function embedBatch(texts = []) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const normalizedList = texts
    .map(normalizeText)
    .filter(Boolean);

  const results = new Array(normalizedList.length);
  const toFetch = [];
  const mapIndex = [];

  // ================= CACHE CHECK =================
  normalizedList.forEach((text, i) => {
    const cacheKey = `embed:${text}`;
    const cached = getCache(cacheKey);

    if (cached) {
      results[i] = cached;
    } else {
      toFetch.push(text);
      mapIndex.push(i);
    }
  });

  if (!toFetch.length) return results;

  try {
    const { url, body } = buildRequest(toFetch);

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), TIMEOUT);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(id);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    const embeddings =
      data?.embeddings ||
      data?.data?.map(d => d.embedding) ||
      [];

    embeddings.forEach((vec, idx) => {
      const i = mapIndex[idx];
      const text = normalizedList[i];

      results[i] = vec;

      setCache(`embed:${text}`, vec);
    });

  } catch (err) {
    console.error("❌ batch embed failed:", err.message);
  }

  return results;
}