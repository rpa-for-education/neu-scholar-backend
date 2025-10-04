import { getDb } from "./db.js";

const DEFAULT_COLLECTION = process.env.SESSION_COLLECTION || "chatlogs";
const DEFAULT_MAX = parseInt(process.env.SHORT_MEMORY || "10", 10);

function normalizeSessionId(sessionId) {
  return sessionId ? String(sessionId).trim() : null;
}

/**
 * Lưu message vào mảng entries của document sessionId
 * Nếu trường entries không phải mảng, cập nhật thành mảng rỗng trước khi push
 * Chỉ ghi những message có text là chuỗi không rỗng
 */
export async function addMemory(sessionId, role, text, maxEntries = DEFAULT_MAX) {
  const sid = normalizeSessionId(sessionId);
  if (!sid) return;

  // Chuyển text sang string nếu cần
  if (typeof text !== "string") {
    try {
      text = JSON.stringify(text);
    } catch {
      // Nếu không chuyển được, không ghi
      return;
    }
  }
  text = text.trim();
  if (!text) return;

  const db = await getDb();
  const col = db.collection(DEFAULT_COLLECTION);

  // Kiểm tra nếu document tồn tại và entries không phải array => chuẩn hóa thành mảng rỗng
  const doc = await col.findOne({ sessionId: sid });
  if (doc && doc.entries && !Array.isArray(doc.entries)) {
    await col.updateOne({ sessionId: sid }, { $set: { entries: [] } });
  }

  const entry = { role, text, createdAt: new Date() };
  await col.updateOne(
    { sessionId: sid },
    {
      $setOnInsert: { sessionId: sid, entries: [] },
      $push: { entries: { $each: [entry], $slice: -maxEntries } }
    },
    { upsert: true }
  );
}

/**
 * Lấy mảng entries đã lưu trữ gần nhất của session, theo limit
 */
export async function getMemory(sessionId, limit = DEFAULT_MAX) {
  const sid = normalizeSessionId(sessionId);
  if (!sid) return [];

  const db = await getDb();
  const col = db.collection(DEFAULT_COLLECTION);

  const doc = await col.findOne({ sessionId: sid }, { projection: { entries: 1 } });
  if (!doc?.entries) return [];
  return Array.isArray(doc.entries) ? doc.entries.slice(-limit) : [];
}

/**
 * Xóa toàn bộ bộ nhớ của session
 */
export async function clearMemory(sessionId) {
  const sid = normalizeSessionId(sessionId);
  if (!sid) return;

  const db = await getDb();
  const col = db.collection(DEFAULT_COLLECTION);
  await col.deleteOne({ sessionId: sid });
}
