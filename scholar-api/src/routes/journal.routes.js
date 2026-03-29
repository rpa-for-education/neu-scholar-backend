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
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         example: Economics
 *       - in: query
 *         name: publisher
 *         schema:
 *           type: string
 *         example: Elsevier
 *       - in: query
 *         name: quartile
 *         schema:
 *           type: string
 *         example: Q1
 *     responses:
 *       200:
 *         description: Success
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
 *             title: "Kinh tế & Phát triển"
 *             country: "Vietnam"
 *             publisher: "ĐH Kinh tế Quốc dân"
 *             categories: "Economics"
 *             areas: "Business"
 *             issn: "1859-0012"
 *     responses:
 *       201:
 *         description: Created
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
 *               publisher: "ĐH Kinh tế Quốc dân"
 *               issn: "1859-0012"
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
 *         example: 69c557e3c58d6676ee672721
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           example:
 *             title: "Kinh tế & Phát triển"
 *             country: "Vietnam"
 *             publisher: "ĐH Kinh tế Quốc dân"
 *             categories: "Economics"
 *             areas: "Business"
 *             issn: "1859-0012"
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
 *         example: 69c557e3c58d6676ee672721
 *     responses:
 *       200:
 *         description: Deleted
 *       404:
 *         description: Not found
 */
router.delete("/:id", deleteJournal);

export default router;