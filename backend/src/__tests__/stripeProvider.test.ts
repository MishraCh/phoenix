import { describe, it, expect, vi, beforeEach } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

const balanceRetrieveMock = vi.fn();
vi.mock("stripe", () => ({
  default: class StripeMock {
    balance = { retrieve: balanceRetrieveMock };
    constructor(_key: string) {}
  },
}));

import { StripeProvider, validateStripeApiKey, readStripeApiKey } from "../integrations/providers/stripe/stripeProvider.js";
import { IntegrationService } from "../integrations/integrationService.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

function asDb(fake: FakeFirestore) {
  return fake as unknown as Firestore;
}

function currentWorkspace() {
  const now = Timestamp.now();
  return {
    id: "ws_test",
    workspace: {
      id: "ws_test",
      name: "WS",
      ownerId: "user_owner",
      plan: "pro",
      planSource: "manual",
      channelsConfig: { emailEnabled: false, whatsappEnabled: false },
      monthlyCreditsLimit: 100,
      monthlyCreditsUsed: 0,
      billingCycleStartAt: now,
      createdAt: now,
      updatedAt: now,
    },
    role: "owner",
  } as never;
}

describe("Stripe provider + API-key connect", () => {
  beforeEach(() => {
    balanceRetrieveMock.mockReset();
    balanceRetrieveMock.mockResolvedValue({ available: [] });
  });

  it("validateStripeApiKey rejects strings that are not sk_/rk_ keys", async () => {
    await expect(validateStripeApiKey("pk_test_publishable")).rejects.toThrow(/restricted/i);
    expect(balanceRetrieveMock).not.toHaveBeenCalled();
  });

  it("validateStripeApiKey rejects keys Stripe refuses", async () => {
    balanceRetrieveMock.mockImplementation(async () => {
      throw new Error("Invalid API Key provided");
    });
    await expect(validateStripeApiKey("rk_test_bad")).rejects.toThrow(/rejected/i);
  });

  it("connectStripeWithApiKey stores the encrypted key and a connected integration doc", async () => {
    const fake = new FakeFirestore();
    const service = new IntegrationService(asDb(fake));

    const result = await service.connectStripeWithApiKey(currentWorkspace(), "user_owner", "rk_test_valid_123");

    expect(result.status).toBe("connected");
    const doc = fake.read("workspaces/ws_test/integrations/stripe")!;
    expect(doc.provider).toBe("stripe");
    expect(doc.status).toBe("connected");
    expect(doc.capabilities).toEqual(["payments.read", "payments.write"]);
    expect(typeof doc.encryptedToken).toBe("string");
    expect(String(doc.encryptedToken)).not.toContain("rk_test_valid_123");

    // The stored key round-trips through the token store.
    const apiKey = await readStripeApiKey(asDb(fake), "ws_test");
    expect(apiKey).toBe("rk_test_valid_123");
  });

  it("getConnectionStatus maps a failing key to an error status with reconnect reason", async () => {
    const fake = new FakeFirestore();
    const service = new IntegrationService(asDb(fake));
    await service.connectStripeWithApiKey(currentWorkspace(), "user_owner", "rk_test_valid_123");

    balanceRetrieveMock.mockImplementation(async () => {
      throw new Error("Expired API Key");
    });
    const provider = new StripeProvider(asDb(fake));
    const status = await provider.getConnectionStatus({ workspaceId: "ws_test", provider: "stripe" } as never);
    expect(status.status).toBe("error");
    expect(status.lastErrorCode).toBe("STRIPE_KEY_INVALID");
  });
});
