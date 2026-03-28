// app.js
import "dotenv/config";
import express from "express";
import cors from "cors";

import { sessionMiddleware } from "./middlewares/session.js";

// 👇 Routes
import scholarRoutes from "./api/scholar/scholar.routes.js";
import fundRoutes from "./api/fund/fund.routes.js";

// 👇 Metadata
import { SCHOLAR_METADATA } from "./config/metadata.scholar.js";
import { FUND_METADATA } from "./config/metadata.fund.js";

const app = express();
const PORT = process.env.PORT || 8014;

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(sessionMiddleware);

// ================= ROUTES =================

// 🎓 Scholar Agent
app.use("/api/scholar", scholarRoutes);

// 💰 Fund Agent
app.use("/api/fund", fundRoutes);

// ================= METADATA =================

// 👉 Scholar metadata
app.get("/api/scholar/metadata", (req, res) => {
  res.json(SCHOLAR_METADATA);
});

// 👉 Fund metadata
app.get("/api/fund/metadata", (req, res) => {
  res.json(FUND_METADATA);
});

// ================= HEALTH =================
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    agents: ["scholar", "fund"],
    timestamp: new Date().toISOString(),
  });
});

// ================= ROOT =================
app.get("/", (_req, res) => {
  res.json({
    message: "NEU AI Agents API",
    endpoints: {
      scholar: "/api/scholar",
      fund: "/api/fund",
      scholar_metadata: "/api/scholar/metadata",
      fund_metadata: "/api/fund/metadata",
      health: "/api/health"
    }
  });
});

// ================= START =================
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});