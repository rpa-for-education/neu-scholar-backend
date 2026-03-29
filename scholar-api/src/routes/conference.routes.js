import express from "express";
import * as ctrl from "../controllers/conference.controller.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: conference
 */

router.get("/", ctrl.getConferences);
router.post("/", ctrl.createConference);
router.get("/:conference_id", ctrl.getConference);
router.put("/:conference_id", ctrl.updateConference);
router.delete("/:conference_id", ctrl.deleteConference);

export default router;