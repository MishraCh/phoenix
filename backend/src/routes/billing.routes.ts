import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import { applyCoupon, createStripeCheckout, openStripePortal } from "../controllers/billingController.js";
import { validateRequest } from "../utils/validateRequest.js";

const applyCouponBodySchema = z.object({
  couponCode: z.string().trim().min(1).max(64),
});

const checkoutBodySchema = z.object({
  plan: z.enum(["plus", "pro"]),
});

export const billingRouter = Router();

billingRouter.post(
  "/billing/apply-coupon",
  authMiddleware,
  validateRequest({ body: applyCouponBodySchema }),
  applyCoupon,
);

billingRouter.post(
  "/billing/checkout",
  authMiddleware,
  validateRequest({ body: checkoutBodySchema }),
  createStripeCheckout,
);

billingRouter.post("/billing/portal", authMiddleware, openStripePortal);
