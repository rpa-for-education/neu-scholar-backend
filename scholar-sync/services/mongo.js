import { MongoClient } from "mongodb";
import "dotenv/config";

let client;
let db;

export async function getDb() {
  if (!db) {
    const uri = process.env.MONGODB_URI;

    const dbName =
      process.env.MONGODB_DB ||
      process.env.DB_NAME ||
      "fitneu";

    if (!uri) {
      throw new Error("❌ MONGODB_URI is missing");
    }

    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 60000,
    });

    await client.connect();
    db = client.db(dbName);

    console.log(`✅ Mongo connected → ${dbName}`);
  }

  return db;
}