import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Firestore } from "firebase-admin/firestore";

const paymentIntentsListMock = vi.fn();
const customersListMock = vi.fn();
const subscriptionsListMock = vi.fn();
const productsCreateMock = vi.fn();
const pricesCreateMock = vi.fn();
const paymentLinksCreateMock = vi.fn();
vi.mock("stripe", () => ({
  default: class StripeMock {
    paymentIntents = { list: paymentIntentsListMock };
    customers = { list: customersListMock };
    subscriptions = { list: subscriptionsListMock };
    products = { create: productsCreateMock };
    prices = { create: pricesCreateMock };
    paymentLinks = { create: paymentLinksCreateMock };
    constructor(_key: string) {}
  },
}));

vi.mock("../integrations/providers/stripe/stripeProvider.js", () => ({
  readStripeApiKey: vi.fn().mockResolvedValue("rk_test_stored"),
}));

import { StripeIntegrationService } from "../integrations/providers/stripe/stripeIntegrationService.js";

const db = {} as Firestore;

describe("StripeIntegrationService", () => {
  beforeEach(() => {
    paymentIntentsListMock.mockReset();
    customersListMock.mockReset();
    subscriptionsListMock.mockReset();
    productsCreateMock.mockReset();
    pricesCreateMock.mockReset();
    paymentLinksCreateMock.mockReset();
  });

  it("getRevenueSummary aggregates succeeded payments + active subscriptions", async () => {
    paymentIntentsListMock.mockResolvedValue({
      data: [
        { status: "succeeded", amount_received: 5000, currency: "usd" },
        { status: "succeeded", amount_received: 2500, currency: "usd" },
        { status: "canceled", amount_received: 0, currency: "usd" },
      ],
    });
    subscriptionsListMock.mockResolvedValue({ data: [{ id: "sub_1" }, { id: "sub_2" }] });

    const summary = await new StripeIntegrationService(db).getRevenueSummary("ws_test");

    expect(summary.grossVolume30d).toBe(7500);
    expect(summary.paymentsCount30d).toBe(2);
    expect(summary.activeSubscriptions).toBe(2);
    expect(summary.currency).toBe("usd");
  });

  it("listCustomers maps to compact records", async () => {
    customersListMock.mockResolvedValue({
      data: [{ id: "cus_1", name: "Jane", email: "jane@acme.com", created: 1750000000 }],
    });
    const customers = await new StripeIntegrationService(db).listCustomers("ws_test", 5);
    expect(customers).toEqual([
      { id: "cus_1", name: "Jane", email: "jane@acme.com", created: new Date(1750000000 * 1000).toISOString() },
    ]);
  });

  it("createPaymentLink chains product -> price -> payment link", async () => {
    productsCreateMock.mockResolvedValue({ id: "prod_1" });
    pricesCreateMock.mockResolvedValue({ id: "price_1" });
    paymentLinksCreateMock.mockResolvedValue({ id: "plink_1", url: "https://buy.stripe.com/test_abc" });

    const result = await new StripeIntegrationService(db).createPaymentLink("ws_test", {
      productName: "Consulting session",
      amountUsd: 99,
    });

    expect(result.url).toContain("buy.stripe.com");
    expect(productsCreateMock).toHaveBeenCalledWith({ name: "Consulting session" });
    expect(pricesCreateMock).toHaveBeenCalledWith({ product: "prod_1", unit_amount: 9900, currency: "usd" });
    expect(paymentLinksCreateMock).toHaveBeenCalledWith({ line_items: [{ price: "price_1", quantity: 1 }] });
  });

  it("createPaymentLink validates the amount", async () => {
    const service = new StripeIntegrationService(db);
    await expect(service.createPaymentLink("ws_test", { productName: "X", amountUsd: 0 })).rejects.toThrow(/amount/i);
    await expect(service.createPaymentLink("ws_test", { productName: "X", amountUsd: 1_000_000 })).rejects.toThrow(/amount/i);
  });
});
