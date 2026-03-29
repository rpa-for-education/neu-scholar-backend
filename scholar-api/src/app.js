// app.js
import express from "express";
import cors from "cors";

import conferenceRoutes from "./routes/conference.routes.js";
import journalRoutes from "./routes/journal.routes.js";
import fundRoutes from "./routes/fund.routes.js";

import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";

const app = express();

app.use(cors());
app.use(express.json());

// ================= API PREFIX =================
const API_PREFIX = "/api/v1";

// ================= DEFAULT ROOT "/" =================
/**
 * @swagger
 * /:
 *   get:
 *     summary: Root
 *     tags: [default]
 *     responses:
 *       200:
 *         description: Welcome message
 *         content:
 *           application/json:
 *             example:
 *               message: "Welcome to Conference, Journal & Fund API"
 *               version: "1.0.0"
 */
app.get("/", (req, res) => {
  res.json({
    message: "Welcome to Conference, Journal & Fund API",
    version: "1.0.0"
  });
});

// ================= API ROOT /api/v1 =================
/**
 * @swagger
 * /api/v1/:
 *   get:
 *     summary: API Root endpoint
 *     tags: [default]
 *     responses:
 *       200:
 *         description: API information
 *         content:
 *           application/json:
 *             example:
 *               message: "Conference, Journal & Fund API is running successfully"
 *               version: "1.0.0"
 *               status: "healthy"
 *               endpoints:
 *                 conference: "/api/v1/conference"
 *                 journal: "/api/v1/journal"
 *                 fund: "/api/v1/fund"
 */
app.get(API_PREFIX + "/", (req, res) => {
  res.json({
    message: "Conference, Journal & Fund API is running successfully",
    version: "1.0.0",
    status: "healthy",
    endpoints: {
      conference: "/api/v1/conference",
      journal: "/api/v1/journal",
      fund: "/api/v1/fund"
    }
  });
});

// ================= HEALTH =================
/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health Check
 *     tags: [default]
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             example:
 *               status: "healthy"
 */
app.get("/health", (req, res) => {
  res.json({
    status: "healthy"
  });
});

// ================= ROUTES =================
app.use(API_PREFIX + "/conference", conferenceRoutes);
app.use(API_PREFIX + "/journal", journalRoutes);
app.use(API_PREFIX + "/fund", fundRoutes);

// ================= SWAGGER =================
const PORT = process.env.PORT || 8030;

const SERVER_URL =
  process.env.SERVER_URL || `http://localhost:${PORT}`;

const specs = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Scholar API",
      version: "1.0.0"
    },

    servers: [
      {
        url: SERVER_URL
      }
    ],

    tags: [
      { name: "default" },
      { name: "conference" },
      { name: "journal" },
      { name: "fund" }
    ]
  },

  apis: ["./src/routes/*.js", "./src/app.js"]
});

// ================= SWAGGER UI (SORT FIX) =================
app.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(specs, {
    operationsSorter: (a, b) => {
      const order = ["/", "/api/v1/", "/health"];

      const aPath = a.get("path");
      const bPath = b.get("path");

      const aIndex = order.indexOf(aPath);
      const bIndex = order.indexOf(bPath);

      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;

      return aIndex - bIndex;
    }
  })
);

export default app;