import type { Request, Response } from "express";

import { requireUser } from "../auth/authMiddleware.js";
import { ActivityService } from "../activity/activityService.js";
import { BillingService } from "../billing/billingService.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
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
