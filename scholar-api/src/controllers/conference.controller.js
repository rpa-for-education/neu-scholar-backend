// controllers/conference.controller.js
import { getDb } from "../db/mongo.js";

export async function getConferences(req, res) {
  const db = await getDb();
  const data = await db.collection("conference").find({}).toArray();
  res.json(data);
}

export async function createConference(req, res) {
  const db = await getDb();
  await db.collection("conference").insertOne(req.body);
  res.json({ message: "Created" });
}

export async function getConference(req, res) {
  const db = await getDb();
  const data = await db.collection("conference")
    .findOne({ _key: req.params.conference_id });
  res.json(data);
}

export async function updateConference(req, res) {
  const db = await getDb();
  await db.collection("conference").updateOne(
    { _key: req.params.conference_id },
    { $set: req.body }
  );
  res.json({ message: "Updated" });
}

export async function deleteConference(req, res) {
  const db = await getDb();
  await db.collection("conference")
    .deleteOne({ _key: req.params.conference_id });
  res.json({ message: "Deleted" });
}