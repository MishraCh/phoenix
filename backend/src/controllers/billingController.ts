import type { Request, Response } from "express";

import { requireUser } from "../auth/authMiddleware.js";
import { ActivityService } from "../activity/activityService.js";
import { BillingService } from "../billing/billingService.js";
import { StripeBillingService } from "../payments/stripeBillingService.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { logger } from "../observability/logger.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";

export async function applyCoupon(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const service = new BillingService(getFirebaseDb());
  const result = await service.applyCoupon({
    couponCode: request.body.couponCode,
    currentWorkspace,
    userId: user.id,
  });
  const activityService = new ActivityService(getFirebaseDb());

  await activityService.createEvent({
    workspaceId: currentWorkspace.id,
    type: "billing.coupon_applied",
    title: `Coupon applied for ${result.plan} plan`,
    actorType: "user",
    actorId: user.id,
    metadata: {
      creditsGranted: result.creditsGranted,
      plan: result.plan,
    },
  });

  response.json(result);
}

export async function createStripeCheckout(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const service = new StripeBillingService(getFirebaseDb());
  const result = await service.createCheckoutSession({
    currentWorkspace,
    userId: user.id,
    plan: request.body.plan,
  });
  response.json(result);
}

export async function openStripePortal(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const service = new StripeBillingService(getFirebaseDb());
  const result = await service.createPortalSession(currentWorkspace);
  response.json(result);
}

/** Mounted with express.raw() BEFORE express.json() — request.body is a Buffer. */
export async function stripeWebhook(request: Request, response: Response) {
  const signature = request.headers["stripe-signature"];
  if (typeof signature !== "string") {
    response.status(400).json({ error: "Missing stripe-signature header." });
    return;
  }

  const service = new StripeBillingService(getFirebaseDb());
  let event;
  try {
    event = service.verifyAndParseEvent(request.body as Buffer, signature);
  } catch (error) {
    logger.warn("Stripe webhook signature verification failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(400).json({ error: "Invalid Stripe webhook signature." });
    return;
  }

  const result = await service.handleWebhookEvent(event as never);
  response.json({ received: true, ...result });
}
