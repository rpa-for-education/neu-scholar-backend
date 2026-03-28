// mongo.js
import { MongoClient } from "mongodb";
import "dotenv/config";

let _client;
let _db;

export async function getDb() {
  if (!_db) {
    const MONGODB_URI = process.env.MONGODB_URI;

    // 🔥 FIX: fallback DB name
    const MONGODB_DB =
      process.env.MONGODB_DB ||
      process.env.DB_NAME ||   // docker dùng cái này
      "fitneu";                // default

    if (!MONGODB_URI) {
      throw new Error("❌ MONGODB_URI is not set in .env");
    }

    // ❌ REMOVE check này (vì đã có default)
    // if (!MONGODB_DB) {
    //   throw new Error("❌ MONGODB_DB is not set in .env");
    // }

    _client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 60000,
      socketTimeoutMS: 60000,
      connectTimeoutMS: 60000,
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