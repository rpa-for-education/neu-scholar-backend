// src/routes/system.routes.js
import express from "express";
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: default
 */

/**
 * @swagger
 * /:
 *   get:
 *     summary: Root check
 *     tags: [default]
 */
router.get("/", (req, res) => res.json({ ok: true }));

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check
 *     tags: [default]
 */
router.get("/health", (req, res) => res.json({ status: "ok" }));

export default router;