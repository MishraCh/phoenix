import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Firestore } from "firebase-admin/firestore";

const sessionsCreateMock = vi.fn();
const portalCreateMock = vi.fn();
const constructEventMock = vi.fn();
vi.mock("stripe", () => ({
  default: class StripeMock {
    checkout = { sessions: { create: sessionsCreateMock } };
    billingPortal = { sessions: { create: portalCreateMock } };
    webhooks = { constructEvent: constructEventMock };
    constructor(_key: string) {}
  },
}));

vi.mock("../config/env.js", () => ({
  env: {
    STRIPE_SECRET_KEY: "rk_test_123",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    STRIPE_PRICE_PLUS: "price_plus_1",
    STRIPE_PRICE_PRO: "price_pro_1",
    FRONTEND_ORIGIN: "http://localhost:3000",
  },
}));

import { StripeBillingService } from "../payments/stripeBillingService.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

function asDb(fake: FakeFirestore) {
  return fake as unknown as Firestore;
}

const currentWorkspace = {
  id: "ws_test",
  workspace: { id: "ws_test", name: "WS", plan: "free" },
  role: "owner",
} as never;

describe("StripeBillingService", () => {
  beforeEach(() => {
    sessionsCreateMock.mockReset();
    portalCreateMock.mockReset();
    constructEventMock.mockReset();
  });

  it("createCheckoutSession builds a subscription Checkout with promo codes and metadata (no payment_method_types)", async () => {
    sessionsCreateMock.mockResolvedValue({ url: "https://checkout.stripe.com/c/s_1" });
    const service = new StripeBillingService(asDb(new FakeFirestore()));
    const result = await service.createCheckoutSession({ currentWorkspace, userId: "u1", plan: "plus" });

    expect(result.url).toContain("checkout.stripe.com");
    const arg = sessionsCreateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.mode).toBe("subscription");
    expect(arg.allow_promotion_codes).toBe(true);
    expect(arg.line_items).toEqual([{ price: "price_plus_1", quantity: 1 }]);
    expect((arg.metadata as Record<string, string>).workspaceId).toBe("ws_test");
    expect(arg.payment_method_types).toBeUndefined();
  });

  it("throws a clear 503 when Stripe is not configured", async () => {
    const env = (await import("../config/env.js")).env as { STRIPE_SECRET_KEY?: string };
    env.STRIPE_SECRET_KEY = undefined;
    const service = new StripeBillingService(asDb(new FakeFirestore()));
    await expect(
      service.createCheckoutSession({ currentWorkspace, userId: "u1", plan: "plus" }),
    ).rejects.toThrow(/not configured/i);
    env.STRIPE_SECRET_KEY = "rk_test_123";
  });

  it("checkout.session.completed fulfills the workspace plan (stripe planSource + credits + ids)", async () => {
    const fake = new FakeFirestore();
    fake.seed("workspaces/ws_test", { plan: "free", planSource: "system", monthlyCreditsLimit: 50, monthlyCreditsUsed: 10 });
    const service = new StripeBillingService(asDb(fake));

    const result = await service.handleWebhookEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { workspaceId: "ws_test", plan: "pro" },
          customer: "cus_123",
          subscription: "sub_456",
        },
      },
    } as never);

    expect(result.handled).toBe(true);
    const doc = fake.read("workspaces/ws_test")!;
    expect(doc.plan).toBe("pro");
    expect(doc.planSource).toBe("stripe");
    expect(doc.monthlyCreditsLimit).toBe(7500);
    expect(doc.monthlyCreditsUsed).toBe(0);
    expect(doc.stripeCustomerId).toBe("cus_123");
    expect(doc.stripeSubscriptionId).toBe("sub_456");
  });

  it("customer.subscription.deleted downgrades the workspace to free", async () => {
    const fake = new FakeFirestore();
    fake.seed("workspaces/ws_test", { plan: "pro", planSource: "stripe", monthlyCreditsLimit: 7500, monthlyCreditsUsed: 5 });
    const service = new StripeBillingService(asDb(fake));

    const result = await service.handleWebhookEvent({
      type: "customer.subscription.deleted",
      data: { object: { metadata: { workspaceId: "ws_test" } } },
    } as never);

    expect(result.handled).toBe(true);
    const doc = fake.read("workspaces/ws_test")!;
    expect(doc.plan).toBe("free");
    expect(doc.planSource).toBe("system");
    expect(doc.monthlyCreditsLimit).toBe(50);
  });

  it("unknown webhook events are a safe no-op", async () => {
    const service = new StripeBillingService(asDb(new FakeFirestore()));
    const result = await service.handleWebhookEvent({ type: "invoice.created", data: { object: {} } } as never);
    expect(result.handled).toBe(false);
  });
});
