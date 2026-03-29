import express from "express";
import * as ctrl from "../controllers/fund.controller.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: fund
 */

router.get("/", ctrl.getFunds);
router.post("/", ctrl.createFund);
router.get("/:fund_id", ctrl.getFund);
router.put("/:fund_id", ctrl.updateFund);
router.delete("/:fund_id", ctrl.deleteFund);

export default router;