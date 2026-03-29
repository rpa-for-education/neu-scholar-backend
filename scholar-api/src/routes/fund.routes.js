import express from "express";
import {
  getFunds,
  createFund,
  getFund,
  updateFund,
  deleteFund
} from "../controllers/fund.controller.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: fund
 */

/**
 * @swagger
 * /api/v1/fund:
 *   get:
 *     summary: List Funds
 *     tags: [fund]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         example: Information Technology
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             example:
 *               data:
 *                 - _id: "69c4fc..."
 *                   opportunity_title: "Pay-for-Performance (PfP) Incentive Payments Program"
 *                   agency_name: "Employment and Training Administration"
 *               meta:
 *                 page: 1
 *                 limit: 10
 *                 total: 100
 */
router.get("/", getFunds);

/**
 * @swagger
 * /api/v1/fund:
 *   post:
 *     summary: Create Fund
 *     tags: [fund]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           example:
 *             opportunity_title: "New Funding Program"
 *             agency_name: "Department of Defense"
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             example:
 *               _id: "69c7ee..."
 *               opportunity_title: "New Funding Program"
 *               agency_name: "Department of Defense"
 */
router.post("/", createFund);

/**
 * @swagger
 * /api/v1/fund/{id}:
 *   get:
 *     summary: Get Fund by ID
 *     tags: [fund]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         example: 69c4fcf6c58d6676ee671ce0
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             example:
 *               _id: "69c4fc..."
 *               opportunity_title: "Pay-for-Performance (PfP) Incentive Payments Program"
 *               agency_name: "Employment and Training Administration"
 *       404:
 *         description: Not found
 */
router.get("/:id", getFund);

/**
 * @swagger
 * /api/v1/fund/{id}:
 *   put:
 *     summary: Update Fund
 *     tags: [fund]
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
 *             agency_name: "Employment and Training Administration"
 *     responses:
 *       200:
 *         description: Updated
 *       404:
 *         description: Not found
 */
router.put("/:id", updateFund);

/**
 * @swagger
 * /api/v1/fund/{id}:
 *   delete:
 *     summary: Delete Fund
 *     tags: [fund]
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
router.delete("/:id", deleteFund);

export default router;