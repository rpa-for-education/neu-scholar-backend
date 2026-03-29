import express from "express";
import {
  getJournals,
  createJournal,
  getJournal,
  updateJournal,
  deleteJournal
} from "../controllers/journal.controller.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: journal
 */

/**
 * @swagger
 * /api/v1/journal:
 *   get:
 *     summary: List Journals
 *     tags: [journal]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         example: Economics
 *       - in: query
 *         name: country
 *         schema:
 *           type: string
 *         example: Vietnam
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             example:
 *               data:
 *                 - _id: "69c557..."
 *                   title: "Kinh tế & Phát triển"
 *                   country: "Vietnam"
 *                   sjr_best_quartile: ""
 *               meta:
 *                 page: 1
 *                 limit: 10
 *                 total: 100
 */
router.get("/", getJournals);

/**
 * @swagger
 * /api/v1/journal:
 *   post:
 *     summary: Create Journal
 *     tags: [journal]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           example:
 *             title: "New Journal"
 *             country: "United States"
 *             sjr_best_quartile: "Q1"
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             example:
 *               _id: "69c7ee..."
 *               title: "New Journal"
 *               country: "United States"
 */
router.post("/", createJournal);

/**
 * @swagger
 * /api/v1/journal/{id}:
 *   get:
 *     summary: Get Journal by ID
 *     tags: [journal]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         example: 69c557e3c58d6676ee672721
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             example:
 *               _id: "69c557..."
 *               title: "Kinh tế & Phát triển"
 *               country: "Vietnam"
 *       404:
 *         description: Not found
 */
router.get("/:id", getJournal);

/**
 * @swagger
 * /api/v1/journal/{id}:
 *   put:
 *     summary: Update Journal
 *     tags: [journal]
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
 *             country: "United Kingdom"
 *     responses:
 *       200:
 *         description: Updated
 *       404:
 *         description: Not found
 */
router.put("/:id", updateJournal);

/**
 * @swagger
 * /api/v1/journal/{id}:
 *   delete:
 *     summary: Delete Journal
 *     tags: [journal]
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
router.delete("/:id", deleteJournal);

export default router;