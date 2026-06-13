// controllers/journal.controller.js
import { getDb } from "../db/mongo.js";
import { ObjectId } from "mongodb";

const COL = "journal";

// ================= GET ALL =================
export const getJournals = async (req, res) => {
  const db = await getDb();

  const {
    search,
    publisher,
    quartile,
    page = 1,
    limit = 10
  } = req.query;

  const query = {};

  if (search && search.trim() !== "") {
    query.$or = [
      { title: { $regex: search, $options: "i" } },
      { categories: { $regex: search, $options: "i" } },
      { areas: { $regex: search, $options: "i" } },
      { text: { $regex: search, $options: "i" } }
    ];
  }

  if (publisher && publisher.trim() !== "") {
    query.publisher = { $regex: publisher, $options: "i" };
  }

  if (quartile && quartile.trim() !== "") {
    query.quartile = quartile;
  }

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    db.collection(COL)
      .find(query)
      .skip(Number(skip))
      .limit(Number(limit))
      .toArray(),
    db.collection(COL).countDocuments(query)
  ]);

  res.json({
    data,
    meta: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
};

// ================= CREATE =================
export const createJournal = async (req, res) => {
  const db = await getDb();

  const { title } = req.body;

  if (!title) {
    return res.status(422).json({
      message: "Validation Error",
      errors: {
        title: ["Title is required"]
      }
    });
  }

  const newItem = {
    ...req.body,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection(COL).insertOne(newItem);

  res.status(201).json({
    _id: result.insertedId,
    ...newItem
  });
};

// ================= GET BY ID =================
export const getJournal = async (req, res) => {
  const db = await getDb();

  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid ID" });
  }

  const item = await db.collection(COL).findOne({
    _id: new ObjectId(req.params.id)
  });

  if (!item) {
    return res.status(404).json({ message: "Not found" });
  }

  res.json(item);
};

// ================= UPDATE =================
export const updateJournal = async (req, res) => {
  const db = await getDb();

  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid ID" });
  }

  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(422).json({
      message: "Validation Error",
      errors: { body: ["Update data is required"] }
    });
  }

  const updateDoc = {
    ...req.body,
    updatedAt: new Date()
  };

  const result = await db.collection(COL).findOneAndUpdate(
    { _id: new ObjectId(req.params.id) },
    { $set: updateDoc },
    { returnDocument: "after" }
  );

  if (!result.value) {
    return res.status(404).json({ message: "Not found" });
  }

  res.json(result.value);
};

// ================= DELETE =================
export const deleteJournal = async (req, res) => {
  const db = await getDb();

  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid ID" });
  }

  const result = await db.collection(COL).deleteOne({
    _id: new ObjectId(req.params.id)
  });

  if (!result.deletedCount) {
    return res.status(404).json({ message: "Not found" });
  }

  res.json({ message: "Deleted" });
};