import { describe, expect, it } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { IntegrationWorkspaceService } from "../integrations/integrationWorkspaceService.js";
import { IntegrationItemRepository } from "../repositories/integrationItemRepository.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { integrationSchema } from "../schemas/coreSchemas.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

function asDb(fake: FakeFirestore) {
  return fake as unknown as Firestore;
}

function currentWorkspace(userId = "user_owner"): CurrentWorkspace {
  const now = Timestamp.now();
  return {
    id: "ws_test",
    workspace: {
      id: "ws_test",
      name: "Workspace",
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
    member: {
      userId,
      workspaceId: "ws_test",
      role: userId === "user_owner" ? "owner" : "member",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    role: userId === "user_owner" ? "owner" : "member",
  };
}

async function seedGmailConnection(fake: FakeFirestore) {
  const now = Timestamp.now();
  const integration = integrationSchema.parse({
    id: "gmail",
    workspaceId: "ws_test",
    provider: "gmail",
    status: "connected",
    scopes: [],
    scopesGranted: [],
    tokenRef: "workspaces/ws_test/integrations/gmail",
    capabilities: ["email.read", "email.draft", "email.send"],
    syncError: null,
    connectedBy: "user_owner",
    ownedByUserId: "user_owner",
    accountEmail: "founder@example.com",
    accountEmailLower: "founder@example.com",
    createdAt: now,
    updatedAt: now,
  });
  fake.seed("workspaces/ws_test/integrations/gmail", integration);
  await new IntegrationItemRepository(asDb(fake)).syncItems(integration, [
    {
      sourceType: "email_thread",
      externalId: "thread_1",
      title: "Board update",
      summary: "Latest board update thread",
      normalizedData: {
        threadId: "thread_1",
        subject: "Board update",
        snippet: "Latest board update thread",
        participants: ["founder@example.com", "board@example.com"],
        messages: [],
        listItem: {
          id: "thread_1",
          threadId: "thread_1",
          subject: "Board update",
          snippet: "Latest board update thread",
          from: "board@example.com",
          lastMessageAt: null,
          unread: false,
        },
      },
    },
  ]);
}

describe("Gmail owner-only access policy", () => {
  it("returns restricted workspace state for non-owners instead of raw Gmail thread data", async () => {
    const fake = new FakeFirestore();
    await seedGmailConnection(fake);
    const service = new IntegrationWorkspaceService(asDb(fake));

    const result = await service.getWorkspaceData(currentWorkspace("user_member"), "user_member", "gmail");
    const connection = result.connection as { access?: string; ownerOnly?: boolean };

    expect(connection.access).toBe("restricted");
    expect(connection.ownerOnly).toBe(true);
    expect(result.list).toEqual([]);
  });

  it("blocks non-owners from opening selected Gmail thread detail", async () => {
    const fake = new FakeFirestore();
    await seedGmailConnection(fake);
    const service = new IntegrationWorkspaceService(asDb(fake));

    await expect(
      service.getSelectedItemDetail(currentWorkspace("user_member"), "user_member", "gmail", {
        itemId: "thread_1",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("blocks non-owners from creating Gmail send approvals", async () => {
    const fake = new FakeFirestore();
    await seedGmailConnection(fake);
    const service = new IntegrationWorkspaceService(asDb(fake));

    await expect(
      service.prepareGmailSendApproval(currentWorkspace("user_member"), "user_member", {
        threadId: "thread_1",
        to: ["board@example.com"],
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("blocks non-owners from executing Gmail sends", async () => {
    const fake = new FakeFirestore();
    await seedGmailConnection(fake);
    const service = new IntegrationWorkspaceService(asDb(fake));

    await expect(
      service.executeApprovedGmailSend(currentWorkspace("user_member"), "user_member", {
        threadId: "thread_1",
        to: ["board@example.com"],
        subject: "Reply",
        body: "Thanks",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
