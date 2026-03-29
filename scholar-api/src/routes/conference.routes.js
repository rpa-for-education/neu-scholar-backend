// routes/conference.routes.js
import express from "express";
import * as ctrl from "../controllers/conference.controller.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: conference
 */

/**
 * @swagger
 * /conference:
 *   get:
 *     summary: Get all conferences
 *     tags: [conference]
 */
router.get("/", ctrl.getConferences);

/**
 * @swagger
 * /conference:
 *   post:
 *     summary: Create conference
 *     tags: [conference]
 */
router.post("/", ctrl.createConference);

/**
 * @swagger
 * /conference/{conference_id}:
 *   get:
 *     summary: Get conference by id
 *     tags: [conference]
 */
router.get("/:conference_id", ctrl.getConference);

/**
 * @swagger
 * /conference/{conference_id}:
 *   put:
 *     summary: Update conference
 *     tags: [conference]
 */
router.put("/:conference_id", ctrl.updateConference);

/**
 * @swagger
 * /conference/{conference_id}:
 *   delete:
 *     summary: Delete conference
 *     tags: [conference]
 */
router.delete("/:conference_id", ctrl.deleteConference);

export default router;