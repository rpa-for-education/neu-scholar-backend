import express from "express";
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: default
 */

router.get("/", (req, res) => res.json({ ok: true }));
router.get("/health", (req, res) => res.json({ status: "ok" }));

export default router;