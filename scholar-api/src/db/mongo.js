import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

let db;

export async function getDb() {
  if (db) return db;

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  db = client.db(process.env.MONGODB_DB);

  console.log("✅ MongoDB connected");

  return db;
}