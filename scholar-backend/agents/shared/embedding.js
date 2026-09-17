// agents/shared/embedding.js

const TIMEOUT =
  Number(process.env.EMBEDDING_TIMEOUT_MS) || 30000;

const MAX_RETRIES =
  Number(process.env.EMBEDDING_MAX_RETRIES) || 1;

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
    value
  });
}

// ================= UTILS =================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeText(text) {
  return String(text || "")
    .trim()
    .toLowerCase();
}

function isValidVector(vector) {
  return (
    Array.isArray(vector) &&
    vector.length > 0 &&
    vector.every(Number.isFinite)
  );
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

  if (!base) {
    throw new Error("Missing OLLAMA_BASE_URL");
  }

  if (!model) {
    throw new Error("Missing OLLAMA_EMBEDDING_MODEL");
  }

  const cleanBase = base.replace(/\/+$/, "");
  const isBatch = Array.isArray(input);

  // ================= AUTO =================
  if (mode === "auto") {
    if (cleanBase.includes("/ollama")) {
      return {
        url: `${cleanBase}/api/embed`,
        body: {
          model,
          input
        }
      };
    }

    return {
      url: `${cleanBase}/api/embeddings`,
      body: {
        model,
        prompt: isBatch
          ? input.join("\n")
          : input
      }
    };
  }

  // ================= PROXY =================
  if (mode === "proxy") {
    return {
      url: `${cleanBase}/api/embed`,
      body: {
        model,
        input
      }
    };
  }

  // ================= NATIVE =================
  return {
    url: `${cleanBase}/api/embeddings`,
    body: {
      model,
      prompt: isBatch
        ? input.join("\n")
        : input
    }
  };
}

// ================= PARSE SINGLE =================
function parseEmbedding(data) {
  const vector =
    data?.embedding ||
    data?.data?.[0]?.embedding ||
    data?.embeddings?.[0] ||
    null;

  return isValidVector(vector)
    ? vector
    : null;
}

// ================= FETCH =================
async function fetchEmbedding(url, body) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      const responseText = await res.text().catch(() => "");

      throw new Error(
        `Embedding HTTP ${res.status}` +
        (responseText
          ? `: ${responseText.slice(0, 300)}`
          : "")
      );
    }

    return await res.json();

  } catch (err) {
    if (
      err?.name === "AbortError" ||
      err?.name === "TimeoutError"
    ) {
      throw new Error(
        `Embedding timeout after ${TIMEOUT}ms`
      );
    }

    throw err;

  } finally {
    clearTimeout(timer);
  }
}

// ================= SINGLE EMBED =================
export async function embed(text) {
  if (!text || !String(text).trim()) {
    return null;
  }

  const normalized = normalizeText(text);
  const cacheKey = `embed:${normalized}`;

  // ================= CACHE =================
  const cached = getCache(cacheKey);

  if (cached) {
    return cached;
  }

  // ================= INFLIGHT =================
  if (INFLIGHT.has(cacheKey)) {
    return INFLIGHT.get(cacheKey);
  }

  const task = (async () => {
    const { url, body } = buildRequest(normalized);

    let lastError = null;

    for (
      let attempt = 0;
      attempt <= MAX_RETRIES;
      attempt++
    ) {
      try {
        const data = await fetchEmbedding(
          url,
          body
        );

        const vector = parseEmbedding(data);

        if (!vector) {
          throw new Error(
            "Invalid embedding response"
          );
        }

        setCache(cacheKey, vector);

        return vector;

      } catch (err) {
        lastError = err;

        console.warn(
          `⚠️ Embedding attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`,
          err.message
        );

        if (attempt < MAX_RETRIES) {
          await sleep(500);
        }
      }
    }

    console.error(
      "❌ Embedding failed:",
      lastError?.message
    );

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
  if (!Array.isArray(texts) || !texts.length) {
    return [];
  }

  const normalizedList = texts
    .map(normalizeText)
    .filter(Boolean);

  if (!normalizedList.length) {
    return [];
  }

  const results =
    new Array(normalizedList.length).fill(null);

  const toFetch = [];
  const mapIndex = [];

  // ================= CACHE CHECK =================
  normalizedList.forEach((text, index) => {
    const cacheKey = `embed:${text}`;
    const cached = getCache(cacheKey);

    if (cached) {
      results[index] = cached;
    } else {
      toFetch.push(text);
      mapIndex.push(index);
    }
  });

  if (!toFetch.length) {
    return results;
  }

  // ================= BATCH REQUEST =================
  try {
    const { url, body } =
      buildRequest(toFetch);

    console.log(
      `🧠 EMBED BATCH: ${toFetch.length} text(s)`
    );

    const data = await fetchEmbedding(
      url,
      body
    );

    const embeddings =
      data?.embeddings ||
      data?.data?.map(item => item.embedding) ||
      [];

    // Batch endpoint phải trả đúng số vector
    if (
      !Array.isArray(embeddings) ||
      embeddings.length !== toFetch.length
    ) {
      throw new Error(
        `Invalid batch embedding response: expected ${toFetch.length}, received ${embeddings?.length || 0}`
      );
    }

    embeddings.forEach((vector, idx) => {
      if (!isValidVector(vector)) {
        throw new Error(
          `Invalid embedding vector at index ${idx}`
        );
      }

      const originalIndex = mapIndex[idx];
      const text =
        normalizedList[originalIndex];

      results[originalIndex] = vector;

      setCache(
        `embed:${text}`,
        vector
      );
    });

    console.log(
      `✅ EMBED BATCH OK: ${embeddings.length} vector(s)`
    );

    return results;

  } catch (err) {
    console.warn(
      "⚠️ Batch embedding failed:",
      err.message
    );

    console.warn(
      "↪️ Falling back to single embeddings..."
    );
  }

  // ================= FALLBACK SINGLE =================
  //
  // Nếu batch timeout / endpoint không hỗ trợ batch,
  // thử từng query riêng lẻ.
  //
  for (let i = 0; i < toFetch.length; i++) {
    const text = toFetch[i];
    const originalIndex = mapIndex[i];

    const vector = await embed(text);

    if (vector) {
      results[originalIndex] = vector;
    }
  }

  // ================= VALIDATION =================
  const validCount =
    results.filter(isValidVector).length;

  console.log(
    `🧠 EMBEDDING RESULT: ${validCount}/${results.length}`
  );

  // Không có vector nào => lỗi retrieval thực sự
  if (validCount === 0) {
    throw new Error(
      "Embedding service unavailable: no valid vectors returned"
    );
  }

  return results;
}