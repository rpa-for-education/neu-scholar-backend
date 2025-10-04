import { getDb } from "./db.js";

const DEFAULT_COLLECTION = process.env.SESSION_COLLECTION || "sessions";
const DEFAULT_MAX = parseInt(process.env.SHORT_MEMORY_SIZE || "10", 10);

function normalizeId(sessionId) {
  return sessionId ? String(sessionId).trim() : null;
}

export async function addMemory(sessionId, role, text, maxEntries = DEFAULT_MAX) {
  const sid = normalizeId(sessionId);
  if (!sid || !text || !text.trim()) return;
  const db = await getDb();
  const col = db.collection(DEFAULT_COLLECTION);

  // Kiểm tra document hiện tại
  const doc = await col.findOne({ sessionId: sid });
  if (doc && !Array.isArray(doc.entries)) {
    // Chuẩn hóa trường entries thành mảng nếu cần
    await col.updateOne({ sessionId: sid }, [{ $set: { entries: { $cond: [{ $isArray: "$entries" }, "$entries", []] } } }]);
  }

  const entry = { role, text: text.trim(), createdAt: new Date() };
  await col.updateOne(
    { sessionId: sid },
    {
      $setOnInsert: { sessionId: sid, createdAt: new Date() },
      $push: {
        entries: {
          $each: [entry],
          $slice: -maxEntries
        }
      }
    },
    { upsert: true }
  );
}

export async function getMemory(sessionId, limit = DEFAULT_MAX) {
  const sid = normalizeId(sessionId);
  if (!sid) return [];
  const db = await getDb();
  const col = db.collection(DEFAULT_COLLECTION);

  const doc = await col.findOne({ sessionId: sid }, { projection: { entries: 1 } });
  if (!doc?.entries) return [];
  return Array.isArray(doc.entries) ? doc.entries.slice(-limit) : [];
}

export async function clearMemory(sessionId) {
  const sid = normalizeId(sessionId);
  if (!sid) return;
  const db = await getDb();
  const col = db.collection(DEFAULT_COLLECTION);
  await col.deleteOne({ sessionId: sid });
}
