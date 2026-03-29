import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

let db;

export async function getDb() {
  if (db) return db;

  if (!process.env.MONGODB_URI) {
    throw new Error("❌ Missing MONGODB_URI in .env");
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  db = client.db(process.env.DB_NAME || "fitneu");

  console.log("✅ Mongo connected");

  return db;
}