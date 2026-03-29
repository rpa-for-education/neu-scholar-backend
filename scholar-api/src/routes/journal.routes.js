import express from "express";
import * as ctrl from "../controllers/journal.controller.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: journal
 */

router.get("/", ctrl.getJournals);
router.post("/", ctrl.createJournal);
router.get("/:journal_id", ctrl.getJournal);
router.put("/:journal_id", ctrl.updateJournal);
router.delete("/:journal_id", ctrl.deleteJournal);

export default router;