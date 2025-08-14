// db.js
import { MongoClient } from "mongodb";
import "dotenv/config";

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "rpa";

let _client;
let _db;

export async function getDb() {
  if (!_db) {
    if (!MONGODB_URI) {
      throw new Error("❌ MONGODB_URI is not set in .env");
    }
    _client = new MongoClient(MONGODB_URI);
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
