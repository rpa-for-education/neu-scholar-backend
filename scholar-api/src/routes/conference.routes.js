// conference.routes.js
import express from "express";
import {
  getConferences,
  createConference,
  getConference,
  updateConference,
  deleteConference
} from "../controllers/conference.controller.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: conference
 */

/**
 * @swagger
 * /api/v1/conference:
 *   get:
 *     summary: List Conferences
 *     tags: [conference]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         example: AI
 *       - in: query
 *         name: country
 *         schema:
 *           type: string
 *         example: China
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             example:
 *               data:
 *                 - _id: "69c7ee..."
 *                   name: "ISAR 2026"
 *                   country: "China"
 *               meta:
 *                 page: 1
 *                 limit: 10
 *                 total: 100
 */
router.get("/", getConferences);

/**
 * @swagger
 * /api/v1/conference:
 *   post:
 *     summary: Create Conference
 *     tags: [conference]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           example:
 *             name: "Test Conference"
 *             country: "Vietnam"
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             example:
 *               _id: "69c7ee..."
 *               name: "Test Conference"
 *               country: "Vietnam"
 */
router.post("/", createConference);

/**
 * @swagger
 * /api/v1/conference/{id}:
 *   get:
 *     summary: Get Conference by ID
 *     tags: [conference]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         example: 69c7ee28c58d6676ee6789ae
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             example:
 *               _id: "69c7ee..."
 *               name: "Conference name"
 *               country: "China"
 *       404:
 *         description: Not found
 */
router.get("/:id", getConference);

/**
 * @swagger
 * /api/v1/conference/{id}:
 *   put:
 *     summary: Update Conference
 *     tags: [conference]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           example:
 *             country: "Japan"
 *     responses:
 *       200:
 *         description: Updated
 *       404:
 *         description: Not found
 */
router.put("/:id", updateConference);

/**
 * @swagger
 * /api/v1/conference/{id}:
 *   delete:
 *     summary: Delete Conference
 *     tags: [conference]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted
 *       404:
 *         description: Not found
 */
router.delete("/:id", deleteConference);

export default router;