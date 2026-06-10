import Stripe from "stripe";
import type { Firestore } from "firebase-admin/firestore";

import { logger } from "../../../observability/logger.js";
import { ApiError } from "../../../utils/apiError.js";
import { readStripeApiKey } from "./stripeProvider.js";

export type StripeRevenueSummary = {
  grossVolume30d: number;
  currency: string;
  paymentsCount30d: number;
  activeSubscriptions: number;
};

export type StripeCustomerRecord = {
  id: string;
  name: string | null;
  email: string | null;
  created: string | null;
};

export type StripePaymentRecord = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  description: string | null;
  customerEmail: string | null;
  created: string | null;
};

export type StripeSubscriptionRecord = {
  id: string;
  status: string;
  customerId: string | null;
  amount: number | null;
  currency: string | null;
  interval: string | null;
  created: string | null;
};

function toIso(epochSeconds: unknown): string | null {
  return typeof epochSeconds === "number" ? new Date(epochSeconds * 1000).toISOString() : null;
}

/**
 * Workspace-scoped Stripe data access using the stored (restricted) API key.
 * Reads power the agent tools + dashboard; createPaymentLink backs the
 * approval-gated payment-link flow.
 */
export class StripeIntegrationService {
  constructor(private readonly db: Firestore) {}

  private async client(workspaceId: string): Promise<Stripe> {
    const apiKey = await readStripeApiKey(this.db, workspaceId);
    return new Stripe(apiKey);
  }

  async getRevenueSummary(workspaceId: string): Promise<StripeRevenueSummary> {
    const stripe = await this.client(workspaceId);
    const since = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

    const payments = await stripe.paymentIntents.list({
      created: { gte: since },
      limit: 100,
    });
    const succeeded = payments.data.filter((intent) => intent.status === "succeeded");
    const grossVolume30d = succeeded.reduce((sum, intent) => sum + (intent.amount_received ?? intent.amount ?? 0), 0);
    const currency = succeeded[0]?.currency ?? "usd";

    const subscriptions = await stripe.subscriptions.list({ status: "active", limit: 100 });

    return {
      grossVolume30d,
      currency,
      paymentsCount30d: succeeded.length,
      activeSubscriptions: subscriptions.data.length,
    };
  }

  async listCustomers(workspaceId: string, limit = 10): Promise<StripeCustomerRecord[]> {
    const stripe = await this.client(workspaceId);
    const customers = await stripe.customers.list({ limit });
    return customers.data.map((customer) => ({
      id: customer.id,
      name: customer.name ?? null,
      email: customer.email ?? null,
      created: toIso(customer.created),
    }));
  }

  async listPayments(workspaceId: string, limit = 10): Promise<StripePaymentRecord[]> {
    const stripe = await this.client(workspaceId);
    const payments = await stripe.paymentIntents.list({ limit });
    return payments.data.map((intent) => ({
      id: intent.id,
      amount: intent.amount,
      currency: intent.currency,
      status: intent.status,
      description: intent.description ?? null,
      customerEmail: intent.receipt_email ?? null,
      created: toIso(intent.created),
    }));
  }

  async listSubscriptions(workspaceId: string, limit = 10): Promise<StripeSubscriptionRecord[]> {
    const stripe = await this.client(workspaceId);
    const subscriptions = await stripe.subscriptions.list({ limit });
    return subscriptions.data.map((subscription) => {
      const item = subscription.items?.data?.[0];
      return {
        id: subscription.id,
        status: subscription.status,
        customerId: typeof subscription.customer === "string" ? subscription.customer : null,
        amount: item?.price?.unit_amount ?? null,
        currency: item?.price?.currency ?? null,
        interval: item?.price?.recurring?.interval ?? null,
        created: toIso(subscription.created),
      };
    });
  }

  async createPaymentLink(
    workspaceId: string,
    input: { productName: string; amountUsd: number; quantity?: number },
  ): Promise<{ url: string; paymentLinkId: string }> {
    if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0 || input.amountUsd > 100_000) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: "Payment link amount must be between $0.01 and $100,000.",
        status: 400,
      });
    }

    const stripe = await this.client(workspaceId);
    const product = await stripe.products.create({ name: input.productName });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(input.amountUsd * 100),
      currency: "usd",
    });
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: input.quantity ?? 1 }],
    });

    logger.info("Stripe payment link created", { workspaceId, paymentLinkId: paymentLink.id });
    return { url: paymentLink.url, paymentLinkId: paymentLink.id };
  }

  /** Aggregated payload for the Stripe workspace dashboard page. */
  async getOverview(workspaceId: string) {
    const [revenue, customers, payments, subscriptions] = await Promise.all([
      this.getRevenueSummary(workspaceId),
      this.listCustomers(workspaceId, 8),
      this.listPayments(workspaceId, 8),
      this.listSubscriptions(workspaceId, 8),
    ]);
    return { revenue, customers, payments, subscriptions };
  }
}
