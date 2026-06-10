import { describe, it, expect } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { IntegrationService } from "../integrations/integrationService.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

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

describe("Gmail coming-soon gate", () => {
  it("blocks NEW gmail connects with FEATURE_COMING_SOON", async () => {
    const service = new IntegrationService(new FakeFirestore() as unknown as Firestore);
    await expect(service.createConnectUrl(currentWorkspace(), "user_owner", "gmail")).rejects.toMatchObject({
      code: "FEATURE_COMING_SOON",
      status: 503,
    });
  });
});
