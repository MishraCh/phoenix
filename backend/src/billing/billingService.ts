import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { getCouponDefinition, normalizeCouponCode } from "./coupons.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { ApiError } from "../utils/apiError.js";
import { invalidateCachedCurrentWorkspace } from "../cache/requestStateCache.js";

type ApplyCouponInput = {
  couponCode: string;
  userId: string;
  currentWorkspace: CurrentWorkspace;
};

function addDays(days: number | null) {
  if (days === null) {
    return undefined;
  }

  return Timestamp.fromDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

export class BillingService {
  constructor(private readonly db: Firestore) {}

  async applyCoupon({ couponCode, currentWorkspace, userId }: ApplyCouponInput) {
    const normalizedCode = normalizeCouponCode(couponCode);
    const coupon = getCouponDefinition(normalizedCode);

    if (!coupon) {
      throw new ApiError({
        code: "COUPON_INVALID",
        message: "Coupon code was not found.",
        status: 400,
      });
    }

    if (!["owner", "admin"].includes(currentWorkspace.role)) {
      throw new ApiError({
        code: "FORBIDDEN",
        message: "Only workspace owners and admins can apply billing coupons.",
        status: 403,
      });
    }

    const workspaceRef = this.db.collection("workspaces").doc(currentWorkspace.id);
    const redemptionRef = workspaceRef.collection("couponRedemptions").doc(normalizedCode);
    const planExpiresAt = addDays(coupon.expiresInDays);

    await this.db.runTransaction(async (transaction) => {
      const redemptionSnapshot = await transaction.get(redemptionRef);

      if (redemptionSnapshot.exists) {
        throw new ApiError({
          code: "COUPON_ALREADY_REDEEMED",
          message: "This coupon has already been redeemed for the workspace.",
          status: 400,
        });
      }

      transaction.update(workspaceRef, {
        plan: coupon.planGranted,
        planSource: "coupon",
        monthlyCreditsLimit: coupon.creditsGranted,
        monthlyCreditsUsed: 0,
        ...(planExpiresAt ? { planExpiresAt } : {}),
        updatedAt: Timestamp.now(),
      });

      transaction.set(redemptionRef, {
        id: normalizedCode,
        couponCode: normalizedCode,
        userId,
        workspaceId: currentWorkspace.id,
        planGranted: coupon.planGranted,
        creditsGranted: coupon.creditsGranted,
        redeemedAt: Timestamp.now(),
        ...(planExpiresAt ? { expiresAt: planExpiresAt } : {}),
      });
    });

    // Invalidate the workspace cache so the next request reads the updated plan from Firestore.
    // Without this, the old plan stays cached for up to 5 minutes and integration/limit checks
    // continue enforcing the previous tier's limits.
    invalidateCachedCurrentWorkspace(userId);

    return {
      plan: coupon.planGranted,
      creditsGranted: coupon.creditsGranted,
      planExpiresAt: planExpiresAt?.toDate().toISOString() ?? null,
    };
  }
}
