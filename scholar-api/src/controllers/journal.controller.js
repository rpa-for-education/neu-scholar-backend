import { getDb } from "../db/mongo.js";
import { buildPagination } from "../utils/pagination.js";

export async function getJournals(req, res) {
  const db = await getDb();
  const { page, limit, skip } = buildPagination(req.query);

  const data = await db.collection("journal")
    .find({})
    .skip(skip)
    .limit(limit)
    .toArray();

  res.json({ page, limit, data });
}

export async function createJournal(req, res) {
  const db = await getDb();
  await db.collection("journal").insertOne(req.body);
  res.json({ message: "Created" });
}

export async function getJournal(req, res) {
  const db = await getDb();
  const data = await db.collection("journal")
    .findOne({ _key: req.params.journal_id });

  res.json(data);
}

export async function updateJournal(req, res) {
  const db = await getDb();
  await db.collection("journal").updateOne(
    { _key: req.params.journal_id },
    { $set: req.body }
  );
  res.json({ message: "Updated" });
}

export async function deleteJournal(req, res) {
  const db = await getDb();
  await db.collection("journal")
    .deleteOne({ _key: req.params.journal_id });

  res.json({ message: "Deleted" });
}