import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import { applyCoupon } from "../controllers/billingController.js";
import { validateRequest } from "../utils/validateRequest.js";

const applyCouponBodySchema = z.object({
  couponCode: z.string().trim().min(1).max(64),
});

export const billingRouter = Router();

billingRouter.post(
  "/billing/apply-coupon",
  authMiddleware,
  validateRequest({ body: applyCouponBodySchema }),
  applyCoupon,
);
