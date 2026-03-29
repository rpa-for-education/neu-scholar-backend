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
 *         example: Information Technology
 *     responses:
 *       200:
 *         description: Success
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
 *             opportunity_title: "Air Force Defense Research Sciences Conference"
 *             agency_name: "Department of Defense"
 *             description: "Research funding for science and technology"
 *     responses:
 *       201:
 *         description: Created
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
 *               opportunity_title: "Pay-for-Performance Program"
 *               agency_name: "Employment and Training Administration"
 *               description: "Funding support program"
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
 *         example: 69c4fcf6c58d6676ee671ce0
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           example:
 *             opportunity_title: "Air Force Defense Research Sciences Conference"
 *             opportunity_number: "AFOSR-2026-0001"
 *             opportunity_status: "posted"
 *             agency_name: "Department of Defense"
 *             agency_code: "DOD"
 *             description: "Research funding for science and technology"
 *             category: "science_and_technology"
 *             category_explanation: ""
 *             funding_instrument_type: "grant"
 *             funding_category: "science"
 *             funding_amount: ""
 *             award_ceiling: ""
 *             award_floor: ""
 *             expected_number_of_awards: ""
 *             post_date: "2026-03-01"
 *             open_date: "2026-03-01"
 *             close_date: "2026-12-31"
 *             archive_date: ""
 *             last_updated_date: ""
 *             version: ""
 *             cost_sharing: ""
 *             is_cost_sharing: "False"
 *             is_forecast: "False"
 *             additional_info_url: ""
 *             additional_info_desc: ""
 *             eligible_applicants: ""
 *             applicant_eligibility_description: ""
 *             agency_contact_description: ""
 *             agency_email_address: ""
 *             agency_phone_number: ""
 *             forecast_award_date: ""
 *             forecast_close_date: ""
 *             forecast_post_date: ""
 *             forecast_start_date: ""
 *             funding_category_description: ""
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
 *         example: 69c4fcf6c58d6676ee671ce0
 *     responses:
 *       200:
 *         description: Deleted
 *       404:
 *         description: Not found
 */
router.delete("/:id", deleteFund);

export default router;