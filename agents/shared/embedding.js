// ./shared/embedding.js

const TIMEOUT = 10000;
const MAX_RETRIES = 2;
const CACHE_TTL = 1000 * 60 * 10; // 10 phút

// ================= SIMPLE CACHE =================
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
function buildRequest(text) {
  const base = process.env.OLLAMA_BASE_URL;
  const model = process.env.OLLAMA_EMBEDDING_MODEL;

  const mode = getMode();

  // 🔥 AUTO detect
  if (mode === "auto") {
    if (base.includes("/ollama")) {
      return {
        url: `${base}/api/embed`,
        body: {
          model,
          input: text,
        },
      };
    }

    return {
      url: `${base}/api/embeddings`,
      body: {
        model,
        prompt: text,
      },
    };
  }

  // 👉 FORCE proxy
  if (mode === "proxy") {
    return {
      url: `${base}/api/embed`,
      body: {
        model,
        input: text,
      },
    };
  }

  // 👉 FORCE ollama
  return {
    url: `${base}/api/embeddings`,
    body: {
      model,
      prompt: text,
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

// ================= MAIN =================
export async function embed(text) {
  if (!text || !text.trim()) return null;

  const normalized = normalizeText(text);

  const cacheKey = `embed:${normalized}`;

  // 🔥 CACHE HIT
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const { url, body } = buildRequest(normalized);

  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), TIMEOUT);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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

      // 🔥 SAVE CACHE
      setCache(cacheKey, vector);

      return vector;

    } catch (err) {
      lastError = err;

      console.warn(
        `⚠️ Embedding attempt ${attempt + 1} failed:`,
        err.message
      );

      if (attempt < MAX_RETRIES) {
        await sleep(300 * (attempt + 1));
      }
    }
  }

  console.error("❌ Embedding failed after retries:", lastError?.message);

  return null; // 👈 không crash hệ thống
}