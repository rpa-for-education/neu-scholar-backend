// shared/cache.js

const CACHE = new Map();

export function getCache(key, ttl = 300000) {
  const item = CACHE.get(key);
  if (!item) return null;

  if (Date.now() - item.time > ttl) {
    CACHE.delete(key);
    return null;
  }

  return item.value;
}

export function setCache(key, value) {
  CACHE.set(key, {
    time: Date.now(),
    value,
  });
}