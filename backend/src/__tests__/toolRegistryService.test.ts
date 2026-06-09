import { describe, expect, it } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { ToolRegistryService } from "../tools/toolRegistryService.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

function asDb(fake: FakeFirestore) {
  return fake as unknown as Firestore;
}

function currentWorkspace(): CurrentWorkspace {
  const now = Timestamp.now();
  return {
    id: "ws_test",
    workspace: {
      id: "ws_test",
      name: "Workspace",
      ownerId: "user_123",
      plan: "pro",
      planSource: "manual",
      channelsConfig: { emailEnabled: false, whatsappEnabled: false },
      monthlyCreditsLimit: 100,
      monthlyCreditsUsed: 0,
      billingCycleStartAt: now,
      createdAt: now,
      updatedAt: now,
    },
    member: {
      userId: "user_123",
      workspaceId: "ws_test",
      role: "owner",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    role: "owner",
  };
}

describe("ToolRegistryService", () => {
  it("does not expose approval-execution-only tools to the planner", () => {
    const service = new ToolRegistryService({} as never);

    const tools = service.listToolsFromCapabilities(["email.send"]);

    expect(tools.some((tool) => tool.name === "gmail.sendApproved")).toBe(false);
    expect(tools.some((tool) => tool.name === "gmail.prepareSendApproval")).toBe(true);
  });

  it("treats syncing Gmail as usable for command capabilities", async () => {
    const fake = new FakeFirestore();
    const now = Timestamp.now();
    fake.seed("workspaces/ws_test/integrations/gmail", {
      workspaceId: "ws_test",
      provider: "gmail",
      status: "syncing",
      scopes: [],
      scopesGranted: [],
      tokenRef: "workspaces/ws_test/integrations/gmail",
      capabilities: ["email.read", "email.draft", "email.send"],
      connectedBy: "user_123",
      ownedByUserId: "user_123",
      createdAt: now,
      updatedAt: now,
    });

    const service = new ToolRegistryService(asDb(fake));
    const capabilities = await service.listCapabilities(currentWorkspace());

    expect(capabilities).toContain("email.read");
    expect(capabilities).toContain("email.send");
  });
});
