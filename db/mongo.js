// db.js
import { MongoClient } from "mongodb";
import "dotenv/config";

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "fitneu";

let _client;
let _db;

export async function getDb() {
  if (!_db) {
    const { MONGODB_URI, MONGODB_DB } = process.env;

    if (!MONGODB_URI) {
      throw new Error("❌ MONGODB_URI is not set in .env");
    }
    if (!MONGODB_DB) {
      throw new Error("❌ MONGODB_DB is not set in .env");
    }

    _client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 60000, // 60s để chọn server
      socketTimeoutMS: 60000,          // 60s tránh disconnect
      connectTimeoutMS: 60000,         // 60s kết nối ban đầu
    });

    await _client.connect();
    _db = _client.db(MONGODB_DB);

    console.log(`✅ MongoDB connected → DB: ${MONGODB_DB}`);
  }

  return _db;
}

export async function closeDb() {
  if (_client) {
    await _client.close();
    _client = null;
    _db = null;
    console.log("🔌 MongoDB connection closed");
  }
}
