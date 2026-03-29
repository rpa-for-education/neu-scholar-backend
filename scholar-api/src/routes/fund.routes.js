// routes/fund.routes.js
import express from "express";
import * as ctrl from "../controllers/fund.controller.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: fund
 */

/**
 * @swagger
 * /fund:
 *   get:
 *     summary: Get all funds
 *     tags: [fund]
 */
router.get("/", ctrl.getFunds);

/**
 * @swagger
 * /fund:
 *   post:
 *     summary: Create fund
 *     tags: [fund]
 */
router.post("/", ctrl.createFund);

/**
 * @swagger
 * /fund/{fund_id}:
 *   get:
 *     summary: Get fund by id
 *     tags: [fund]
 */
router.get("/:fund_id", ctrl.getFund);

/**
 * @swagger
 * /fund/{fund_id}:
 *   put:
 *     summary: Update fund
 *     tags: [fund]
 */
router.put("/:fund_id", ctrl.updateFund);

/**
 * @swagger
 * /fund/{fund_id}:
 *   delete:
 *     summary: Delete fund
 *     tags: [fund]
 */
router.delete("/:fund_id", ctrl.deleteFund);

export default router;