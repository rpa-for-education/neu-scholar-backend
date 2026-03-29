// src/app.js
import express from "express";
import cors from "cors";

import systemRoutes from "./routes/system.routes.js";
import conferenceRoutes from "./routes/conference.routes.js";
import journalRoutes from "./routes/journal.routes.js";
import fundRoutes from "./routes/fund.routes.js";

import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";

const app = express();

app.use(cors());
app.use(express.json());

const API_PREFIX = "/api/v1";

// routes
app.use(API_PREFIX, systemRoutes);
app.use(API_PREFIX + "/conference", conferenceRoutes);
app.use(API_PREFIX + "/journal", journalRoutes);
app.use(API_PREFIX + "/fund", fundRoutes);

// swagger
const specs = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Scholar API",
      version: "1.0.0"
    },
    servers: [
      { url: "http://localhost:8025/api/v1" }
    ]
  },
  apis: ["./src/routes/*.js"]
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(specs));

export default app;