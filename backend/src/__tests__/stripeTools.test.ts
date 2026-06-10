import { describe, it, expect, vi, beforeEach } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

const revenueMock = vi.fn();
const createLinkMock = vi.fn();
vi.mock("../integrations/providers/stripe/stripeIntegrationService.js", () => ({
  StripeIntegrationService: class {
    getRevenueSummary = revenueMock;
    createPaymentLink = createLinkMock;
  },
}));

import { getToolDefinition } from "../tools/toolRegistry.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

function ctx(fake: FakeFirestore) {
  const now = Timestamp.now();
  return {
    db: fake as unknown as Firestore,
    currentWorkspace: {
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
    },
    userId: "user_owner",
  } as never;
}

describe("stripe agent tools", () => {
  beforeEach(() => {
    revenueMock.mockReset();
    createLinkMock.mockReset();
  });

  it("stripe.revenueSummary returns the revenue snapshot", async () => {
    revenueMock.mockResolvedValue({ grossVolume30d: 7500, currency: "usd", paymentsCount30d: 2, activeSubscriptions: 3 });
    const tool = getToolDefinition("stripe.revenueSummary")!.buildTool(ctx(new FakeFirestore()));
    const out = (await tool.invoke({})) as { status: string; grossVolume30d: number };
    expect(out.status).toBe("completed");
    expect(out.grossVolume30d).toBe(7500);
  });

  it("stripe.preparePaymentLinkApproval creates ONE approval targeting the approved tool (no link yet)", async () => {
    const fake = new FakeFirestore();
    const tool = getToolDefinition("stripe.preparePaymentLinkApproval")!.buildTool(ctx(fake));
    const out = (await tool.invoke({ productName: "Consulting session", amountUsd: 99 })) as {
      approvalId: string;
      actionType: string;
    };

    expect(out.approvalId).toBeTruthy();
    expect(out.actionType).toBe("stripe_payment_link");
    expect(createLinkMock).not.toHaveBeenCalled(); // propose-only

    const approval = fake.read(`workspaces/ws_test/approvals/${out.approvalId}`)!;
    expect(approval.type).toBe("other");
    expect(approval.proposedAction).toMatchObject({
      toolName: "stripe.createPaymentLinkApproved",
      actionType: "stripe_payment_link",
      requiresApproval: true,
    });
    expect((approval.preview as Record<string, unknown>).amountUsd).toBe(99);
  });

  it("stripe.createPaymentLinkApproved executes the link creation", async () => {
    createLinkMock.mockResolvedValue({ url: "https://buy.stripe.com/test_x", paymentLinkId: "plink_1" });
    const tool = getToolDefinition("stripe.createPaymentLinkApproved")!.buildTool(ctx(new FakeFirestore()));
    const out = (await tool.invoke({ productName: "Consulting session", amountUsd: 99 })) as { url: string };
    expect(out.url).toContain("buy.stripe.com");
  });

  it("the approved tool is hidden from the planner; reads are exposed", () => {
    expect(getToolDefinition("stripe.createPaymentLinkApproved")!.exposedToPlanner).toBe(false);
    expect(getToolDefinition("stripe.revenueSummary")!.exposedToPlanner).not.toBe(false);
    expect(getToolDefinition("stripe.revenueSummary")!.capabilitiesRequired).toEqual(["payments.read"]);
    expect(getToolDefinition("stripe.preparePaymentLinkApproval")!.capabilitiesRequired).toEqual(["payments.write"]);
  });
});
