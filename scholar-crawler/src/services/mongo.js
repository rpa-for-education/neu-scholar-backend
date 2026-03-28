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

    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 60000,
    });

    await client.connect();
    db = client.db(dbName);

    console.log("✅ Mongo connected (crawler)");
  }

  return db;
}