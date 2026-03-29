import { getDb } from "../db/mongo.js";
import { ObjectId } from "mongodb";

const COL = "fund";

// ================= GET ALL =================
export const getFunds = async (req, res) => {
  const db = await getDb();

  const {
    q,
    agency,
    category,
    page = 1,
    limit = 10
  } = req.query;

  const query = {};

  // 🔥 SEARCH
  if (q && q.trim() !== "") {
    query.$or = [
      { opportunity_title: { $regex: q, $options: "i" } },
      { description: { $regex: q, $options: "i" } },
      { agency_name: { $regex: q, $options: "i" } },
      { text: { $regex: q, $options: "i" } }
    ];
  }

  // 🔥 FILTER
  if (agency && agency.trim() !== "") {
    query.agency_name = { $regex: agency, $options: "i" };
  }

  if (category && category.trim() !== "") {
    query.category = { $regex: category, $options: "i" };
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
export const createFund = async (req, res) => {
  const db = await getDb();

  const { opportunity_title } = req.body;

  if (!opportunity_title) {
    return res.status(422).json({
      message: "Validation Error",
      errors: {
        opportunity_title: ["Title is required"]
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

  const result = await db.collection(COL).findOneAndUpdate(
    { _id: new ObjectId(req.params.id) },
    {
      $set: {
        ...req.body,
        updatedAt: new Date()
      }
    },
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