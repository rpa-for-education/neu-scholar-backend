// controllers/fund.controller.js
import { getDb } from "../db/mongo.js";
import { buildPagination } from "../utils/pagination.js";

export async function getFunds(req, res) {
  const db = await getDb();
  const { page, limit, skip } = buildPagination(req.query);

  const data = await db.collection("fund")
    .find({})
    .skip(skip)
    .limit(limit)
    .toArray();

  res.json({ page, limit, data });
}

export async function createFund(req, res) {
  const db = await getDb();
  await db.collection("fund").insertOne(req.body);
  res.json({ message: "Created" });
}

export async function getFund(req, res) {
  const db = await getDb();
  const data = await db.collection("fund")
    .findOne({ _key: req.params.fund_id });

  res.json(data);
}

export async function updateFund(req, res) {
  const db = await getDb();
  await db.collection("fund").updateOne(
    { _key: req.params.fund_id },
    { $set: req.body }
  );
  res.json({ message: "Updated" });
}

export async function deleteFund(req, res) {
  const db = await getDb();
  await db.collection("fund")
    .deleteOne({ _key: req.params.fund_id });

  res.json({ message: "Deleted" });
}