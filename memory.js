import { getDb } from "./db.js";

const DEFAULT_COLLECTION = process.env.SESSION_COLLECTION || "sessions";
const DEFAULT_MAX = parseInt(process.env.SHORT_MEMORY_SIZE || "10", 10);

function normalizeSessionId(sessionId) {
  return sessionId ? String(sessionId).trim() : null;
}

/**
 * Lưu message vào mảng entries của document sessionId, tạo mới nếu chưa có
 * Chuẩn hóa entries thành mảng để tránh lỗi conflict MongoDB
 */
export async function addMemory(sessionId, role, text, maxEntries = DEFAULT_MAX) {
  const sessionIdStr = normalizeSessionId(sessionId);
  if (!sessionIdStr) return;

  // Đảm bảo text là chuỗi trước khi trim
  if (typeof text !== "string") {
    // Chuyển về chuỗi JSON hoặc bỏ qua nếu không hợp lệ
    try {
      text = JSON.stringify(text);
    } catch {
      return; // Ko lưu nếu không thể chuyển thành chuỗi
    }
  }

  text = text.trim();
  if (!text) return;

  const db = await getDb();
  const col = db.collection(DEFAULT_COLLECTION);

  // Kiểm tra document hiện tại
  const doc = await col.findOne({ sessionId: sessionIdStr });
  if (doc && !Array.isArray(doc.entries)) {
    // Chuẩn hóa entries thành mảng nếu cần
    await col.updateOne(
      { sessionId: sessionIdStr },
      [{ $set: { entries: { $cond: [{ $isArray: "$entries" }, "$entries", []] } } }]
    );
  }

  const entry = { role, text, createdAt: new Date() };

  // Thêm entry mới với giới hạn maxEntries
  await col.updateOne(
    { sessionId: sessionIdStr },
    {
      $setOnInsert: { sessionId: sessionIdStr, entries: [] },
      $push: { entries: { $each: [entry], $slice: -maxEntries } }
    },
    { upsert: true }
  );
}

/**
 * Lấy mảng entries gần nhất của session
 */
export async function getMemory(sessionId, limit = DEFAULT_MAX) {
  const sessionIdStr = normalizeSessionId(sessionId);
  if (!sessionIdStr) return [];

  const db = await getDb();
  const col = db.collection(DEFAULT_COLLECTION);

  const doc = await col.findOne({ sessionId: sessionIdStr }, { projection: { entries: 1 } });
  if (!doc?.entries) return [];
  return Array.isArray(doc.entries) ? doc.entries.slice(-limit) : [];
}

/**
 * Xóa toàn bộ memory của session
 */
export async function clearMemory(sessionId) {
  const sessionIdStr = normalizeSessionId(sessionId);
  if (!sessionIdStr) return;

  const db = await getDb();
  const col = db.collection(DEFAULT_COLLECTION);
  await col.deleteOne({ sessionId: sessionIdStr });
}
