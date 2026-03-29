// src/controllers/fund.controller.js --- IGNORE ---
import { getDb } from "../db/mongo.js";
import { ObjectId } from "mongodb";

const COL = "fund";

// ================= GET ALL =================
export const getFunds = async (req, res) => {
  const db = await getDb();

  const { search, page = 1, limit = 10 } = req.query;

  const query = {};

  if (search) {
    query.$or = [
      { opportunity_title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
      { agency_name: { $regex: search, $options: "i" } },
      { text: { $regex: search, $options: "i" } }
    ];
  }

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    db.collection(COL).find(query).skip(skip).limit(Number(limit)).toArray(),
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

// ================= CREATE (UPGRADED) =================
export const createFund = async (req, res) => {
  const db = await getDb();

  const { opportunity_title, agency_name, description } = req.body;

  if (!opportunity_title) {
    return res.status(422).json({
      message: "Validation Error",
      errors: {
        opportunity_title: ["Title is required"]
      }
    });
  }

  const u_key = opportunity_title.toLowerCase().trim();

  const doc = {
    ...req.body,
    text: [opportunity_title, agency_name, description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    u_key,
    updatedAt: new Date()
  };

  const result = await db.collection(COL).findOneAndUpdate(
    { u_key },
    {
      $set: doc,
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true, returnDocument: "after" }
  );

  res.status(201).json(result.value);
};

// ================= GET BY ID =================
export const getFund = async (req, res) => {
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
export const updateFund = async (req, res) => {
  const db = await getDb();

  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid ID" });
  }

  // ❗ không cho update rỗng
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(422).json({
      message: "Validation Error",
      errors: { body: ["Update data is required"] }
    });
  }

  const { opportunity_title, agency_name, description } = req.body;

  const updateDoc = {
    ...req.body,
    updatedAt: new Date()
  };

  // 🔥 rebuild text nếu có field liên quan
  if (opportunity_title || agency_name || description) {
    updateDoc.text = [
      opportunity_title,
      agency_name,
      description
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

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
export const deleteFund = async (req, res) => {
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