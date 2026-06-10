import Stripe from "stripe";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

import { env } from "../config/env.js";
import { logger } from "../observability/logger.js";
import { ApiError } from "../utils/apiError.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";

/** Credits granted per paid plan — mirrors the coupon grants in billing/coupons.ts. */
const PLAN_CREDITS: Record<"plus" | "pro", number> = { plus: 1500, pro: 7500 };
const FREE_CREDITS = 50;

type PaidPlan = "plus" | "pro";

type WebhookEventShape = {
  type: string;
  data: { object: Record<string, unknown> };
};

/**
 * Stripe payment gateway on top of the existing billing logic.
 * Checkout (subscription mode, promo codes enabled) + Customer Portal + webhook
 * fulfillment that writes the same workspace fields applyCoupon writes.
 */
export class StripeBillingService {
  constructor(private readonly db: Firestore) {}

  private stripe(): Stripe {
    if (!env.STRIPE_SECRET_KEY) {
      throw new ApiError({
        code: "STRIPE_CONFIG_MISSING",
        message: "Stripe is not configured (STRIPE_SECRET_KEY missing).",
        status: 503,
      });
    }
    return new Stripe(env.STRIPE_SECRET_KEY);
  }

  private priceFor(plan: PaidPlan): string {
    const price = plan === "plus" ? env.STRIPE_PRICE_PLUS : env.STRIPE_PRICE_PRO;
    if (!price) {
      throw new ApiError({
        code: "STRIPE_CONFIG_MISSING",
        message: `Stripe price for the ${plan} plan is not configured.`,
        status: 503,
      });
    }
    return price;
  }

  private appBaseUrl(): string {
    return env.FRONTEND_ORIGIN?.split(",")[0]?.trim() || "http://localhost:3000";
  }

  async createCheckoutSession(input: {
    currentWorkspace: CurrentWorkspace;
    userId: string;
    plan: PaidPlan;
  }): Promise<{ url: string | null }> {
    const stripe = this.stripe();
    const price = this.priceFor(input.plan);
    const base = this.appBaseUrl();
    const workspace = input.currentWorkspace.workspace as { stripeCustomerId?: string };
    const metadata = { workspaceId: input.currentWorkspace.id, plan: input.plan };

    // NOTE: never pass payment_method_types — dynamic payment methods.
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      ...(workspace.stripeCustomerId ? { customer: workspace.stripeCustomerId } : {}),
      metadata,
      subscription_data: { metadata },
      success_url: `${base}/settings?stripe=success`,
      cancel_url: `${base}/settings?stripe=cancelled`,
    });

    return { url: session.url };
  }

  async createPortalSession(currentWorkspace: CurrentWorkspace): Promise<{ url: string }> {
    const stripe = this.stripe();
    const customerId = (currentWorkspace.workspace as { stripeCustomerId?: string }).stripeCustomerId;
    if (!customerId) {
      throw new ApiError({
        code: "STRIPE_NO_CUSTOMER",
        message: "This workspace has no Stripe billing yet. Upgrade a plan first.",
        status: 400,
      });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${this.appBaseUrl()}/settings`,
    });
    return { url: session.url };
  }

  verifyAndParseEvent(rawBody: Buffer | string, signature: string): Stripe.Event {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new ApiError({
        code: "STRIPE_CONFIG_MISSING",
        message: "Stripe webhook secret is not configured.",
        status: 503,
      });
    }
    return this.stripe().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  }

  /** Idempotent fulfillment — re-delivered events re-write the same state safely. */
  async handleWebhookEvent(event: WebhookEventShape): Promise<{ handled: boolean }> {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as {
        metadata?: { workspaceId?: string; plan?: string };
        customer?: unknown;
        subscription?: unknown;
      };
      const workspaceId = session.metadata?.workspaceId;
      const plan = session.metadata?.plan;
      if (!workspaceId || (plan !== "plus" && plan !== "pro")) {
        logger.warn("Stripe checkout.session.completed missing workspace/plan metadata", {
          workspaceId: workspaceId ?? null,
          plan: plan ?? null,
        });
        return { handled: false };
      }

      await this.db.collection("workspaces").doc(workspaceId).update({
        plan,
        planSource: "stripe",
        monthlyCreditsLimit: PLAN_CREDITS[plan],
        monthlyCreditsUsed: 0,
        ...(typeof session.customer === "string" ? { stripeCustomerId: session.customer } : {}),
        ...(typeof session.subscription === "string" ? { stripeSubscriptionId: session.subscription } : {}),
        updatedAt: Timestamp.now(),
      });
      logger.info("Stripe checkout fulfilled", { workspaceId, plan });
      return { handled: true };
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as { metadata?: { workspaceId?: string } };
      const workspaceId = subscription.metadata?.workspaceId;
      if (!workspaceId) {
        logger.warn("Stripe subscription.deleted without workspace metadata — ignoring");
        return { handled: false };
      }
      await this.db.collection("workspaces").doc(workspaceId).update({
        plan: "free",
        planSource: "system",
        monthlyCreditsLimit: FREE_CREDITS,
        stripeSubscriptionId: FieldValue.delete(),
        updatedAt: Timestamp.now(),
      });
      logger.info("Stripe subscription cancelled — workspace downgraded", { workspaceId });
      return { handled: true };
    }

    return { handled: false };
  }
}
