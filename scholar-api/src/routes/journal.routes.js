// routes/journal.routes.js
import express from "express";
import * as ctrl from "../controllers/journal.controller.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: journal
 */

/**
 * @swagger
 * /journal:
 *   get:
 *     summary: Get all journals
 *     tags: [journal]
 */
router.get("/", ctrl.getJournals);

/**
 * @swagger
 * /journal:
 *   post:
 *     summary: Create journal
 *     tags: [journal]
 */
router.post("/", ctrl.createJournal);

/**
 * @swagger
 * /journal/{journal_id}:
 *   get:
 *     summary: Get journal by id
 *     tags: [journal]
 */
router.get("/:journal_id", ctrl.getJournal);

/**
 * @swagger
 * /journal/{journal_id}:
 *   put:
 *     summary: Update journal
 *     tags: [journal]
 */
router.put("/:journal_id", ctrl.updateJournal);

/**
 * @swagger
 * /journal/{journal_id}:
 *   delete:
 *     summary: Delete journal
 *     tags: [journal]
 */
router.delete("/:journal_id", ctrl.deleteJournal);

export default router;