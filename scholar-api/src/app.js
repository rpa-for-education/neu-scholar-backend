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

// ================= ROUTES =================
app.use(API_PREFIX + "/conference", conferenceRoutes);
app.use(API_PREFIX + "/journal", journalRoutes);
app.use(API_PREFIX + "/fund", fundRoutes);

// ================= SWAGGER =================
const PORT = process.env.PORT || 8030;

// 🔥 KHÔNG gắn API_PREFIX ở đây nữa
const SERVER_URL =
  process.env.SERVER_URL || `http://localhost:${PORT}`;

const specs = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Scholar API",
      version: "1.0.0",
      description: "Conference / Journal / Fund API (Production Ready)"
    },

    // ✅ FIX QUAN TRỌNG: KHÔNG + API_PREFIX
    servers: [
      {
        url: SERVER_URL
      }
    ],

    components: {
      schemas: {
        // ===== CONFERENCE =====
        Conference: {
          type: "object",
          properties: {
            _id: { type: "string", example: "69c7ee28c58d6676ee6789ae" },
            name: { type: "string", example: "ICAI 2026" },
            country: { type: "string", example: "China" },
            start_date: { type: "string" },
            deadline: { type: "string" }
          }
        },

        // ===== JOURNAL =====
        Journal: {
          type: "object",
          properties: {
            _id: { type: "string" },
            title: { type: "string", example: "CA-A Cancer Journal" },
            country: { type: "string", example: "United States" },
            publisher: { type: "string", example: "Wiley" }
          }
        },

        // ===== FUND =====
        Fund: {
          type: "object",
          properties: {
            _id: { type: "string" },
            opportunity_title: {
              type: "string",
              example: "AI Research Grant"
            },
            agency_name: {
              type: "string",
              example: "NASA"
            }
          }
        },

        // ===== PAGINATION =====
        Pagination: {
          type: "object",
          properties: {
            page: { type: "integer", example: 1 },
            limit: { type: "integer", example: 10 },
            total: { type: "integer", example: 100 },
            totalPages: { type: "integer", example: 10 }
          }
        },

        // ===== RESPONSE =====
        ConferenceListResponse: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/Conference" }
            },
            meta: { $ref: "#/components/schemas/Pagination" }
          }
        },

        JournalListResponse: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/Journal" }
            },
            meta: { $ref: "#/components/schemas/Pagination" }
          }
        },

        FundListResponse: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/Fund" }
            },
            meta: { $ref: "#/components/schemas/Pagination" }
          }
        }
      }
    }
  },

  // load swagger từ routes
  apis: ["./src/routes/*.js"]
});

// ================= SWAGGER UI =================
app.use("/docs", swaggerUi.serve, swaggerUi.setup(specs));

// ================= ROOT =================
app.get("/", (req, res) => {
  res.json({
    message: "Scholar API running",
    docs: "/docs"
  });
});

export default app;