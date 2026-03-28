const CACHE = new Map();
const TTL = 1000 * 60 * 60; // 1h

export function getEmbedCache(key) {
  const item = CACHE.get(key);
  if (!item) return null;

  if (Date.now() - item.time > TTL) {
    CACHE.delete(key);
    return null;
  }

  return item.value;
}

export function setEmbedCache(key, value) {
  CACHE.set(key, {
    value,
    time: Date.now()
  });
}