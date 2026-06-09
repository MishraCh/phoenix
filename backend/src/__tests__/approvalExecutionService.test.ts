import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { ApprovalExecutionService } from "../actions/approvalExecutionService.js";
import { ApprovalService } from "../approvals/approvalService.js";
import { approvalSchema, type Approval } from "../schemas/coreSchemas.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { GmailProvider } from "../integrations/providers/gmail/gmailProvider.js";
import { HubSpotProvider } from "../integrations/providers/hubspot/hubspotProvider.js";
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

function seedGmailConnection(fake: FakeFirestore, overrides: Record<string, unknown> = {}) {
  const now = Timestamp.now();
  fake.seed("workspaces/ws_test/integrations/gmail", {
    workspaceId: "ws_test",
    provider: "gmail",
    status: "connected",
    scopes: [],
    scopesGranted: [],
    tokenRef: "workspaces/ws_test/integrations/gmail",
    capabilities: ["email.read", "email.draft", "email.send"],
    syncError: null,
    connectedBy: "user_123",
    ownedByUserId: "user_123",
    syncStatus: "idle",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

function seedApproval(fake: FakeFirestore, overrides: Record<string, unknown> = {}): Approval {
  const now = Timestamp.now();
  const approval = approvalSchema.parse({
    id: "approval_1",
    workspaceId: "ws_test",
    type: "email_send",
    status: "approved",
    title: "Send Gmail reply",
    reason: "Requires approval before sending externally.",
    preview: {
      to: ["recipient@example.com"],
      cc: [],
      subject: "Reply subject",
      body: "Draft body",
    },
    proposedAction: {
      toolName: "gmail.sendApproved",
      actionType: "gmail_send",
      input: {
        threadId: "thread_1",
        to: ["recipient@example.com"],
        cc: [],
        subject: "Reply subject",
        body: "Draft body",
      },
      requiresApproval: true,
      riskLevel: "medium",
    },
    riskLevel: "medium",
    sourceRefs: [],
    approvedBy: "user_123",
    approvedAt: now,
    idempotencyKey: "approval-key-1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
  fake.seed("workspaces/ws_test/approvals/approval_1", approval);
  return approval;
}

function seedHubSpotConnection(fake: FakeFirestore, overrides: Record<string, unknown> = {}) {
  const now = Timestamp.now();
  fake.seed("workspaces/ws_test/integrations/hubspot", {
    workspaceId: "ws_test",
    provider: "hubspot",
    status: "connected",
    scopes: [],
    scopesGranted: [],
    tokenRef: "workspaces/ws_test/integrations/hubspot",
    capabilities: ["crm.read", "crm.write"],
    syncError: null,
    connectedBy: "user_123",
    ownedByUserId: "user_123",
    syncStatus: "idle",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

describe("ApprovalExecutionService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("executes approved Gmail sends and marks the approval executed", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake);
    const approval = seedApproval(fake);
    vi.spyOn(GmailProvider.prototype, "sendMessage").mockResolvedValue({
      messageId: "message_1",
      threadId: "thread_1",
      labelIds: ["SENT"],
    });

    const result = await new ApprovalExecutionService(asDb(fake)).executeApprovedAction(
      currentWorkspace(),
      approval,
      "user_123",
    );

    expect(result.status).toBe("executed");
    const storedApproval = fake.read("workspaces/ws_test/approvals/approval_1");
    expect(storedApproval?.["status"]).toBe("executed");
    expect(storedApproval?.["executedAt"]).toBeInstanceOf(Timestamp);
    expect(storedApproval?.["executionStatus"]).toBe("executed");
    expect(storedApproval?.["externalActionId"]).toBe("message_1");
  });

  it("returns unsupported for approvals without a registered executable tool", async () => {
    const fake = new FakeFirestore();
    const approval = seedApproval(fake, {
      proposedAction: {
        toolName: "unknown.tool",
        actionType: "unknown_action",
        input: { value: "noop" },
        requiresApproval: true,
        riskLevel: "high",
      },
    });

    const result = await new ApprovalExecutionService(asDb(fake)).executeApprovedAction(
      currentWorkspace(),
      approval,
      "user_123",
    );

    expect(result.status).toBe("unsupported");
    const storedApproval = fake.read("workspaces/ws_test/approvals/approval_1");
    expect(storedApproval?.["status"]).toBe("approved");
  });

  it("executes approved HubSpot updates and marks the approval executed", async () => {
    const fake = new FakeFirestore();
    seedHubSpotConnection(fake);
    const approval = seedApproval(fake, {
      type: "crm_update",
      riskLevel: "high",
      title: "Update HubSpot deal",
      proposedAction: {
        toolName: "hubspot.updateApproved",
        actionType: "hubspot_update",
        input: {
          module: "deals",
          recordId: "deal_1",
          updates: { dealstage: "closedwon" },
        },
        requiresApproval: true,
        riskLevel: "high",
      },
    });
    vi.spyOn(HubSpotProvider.prototype, "getConnectionStatus").mockResolvedValue({ status: "connected" });
    vi.spyOn(HubSpotProvider.prototype, "updateRecord").mockResolvedValue({
      id: "deal_1",
      properties: { dealstage: "closedwon", dealname: "Big Deal" },
      updatedAt: "2026-05-18T10:00:00.000Z",
      archived: false,
    });

    const result = await new ApprovalExecutionService(asDb(fake)).executeApprovedAction(
      currentWorkspace(),
      approval,
      "user_123",
    );

    expect(result.status).toBe("executed");
    const storedApproval = fake.read("workspaces/ws_test/approvals/approval_1");
    expect(storedApproval?.["status"]).toBe("executed");
    expect(storedApproval?.["executionStatus"]).toBe("executed");
    expect(storedApproval?.["externalActionId"]).toBe("deal_1");
    expect(storedApproval?.["executionResult"]).toMatchObject({
      recordId: "deal_1",
      module: "deals",
    });
  });

  it("marks the approval failed when approved Gmail execution throws", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake);
    const approval = seedApproval(fake);
    vi.spyOn(GmailProvider.prototype, "sendMessage").mockRejectedValue(new Error("gmail send failed"));

    await expect(
      new ApprovalExecutionService(asDb(fake)).executeApprovedAction(
        currentWorkspace(),
        approval,
        "user_123",
      ),
    ).rejects.toThrow("gmail send failed");

    const storedApproval = fake.read("workspaces/ws_test/approvals/approval_1");
    expect(storedApproval?.["status"]).toBe("failed");
    expect(storedApproval?.["error"]).toBe("gmail send failed");
    expect(storedApproval?.["executionStatus"]).toBe("failed");
  });

  it("reuses the stored Gmail execution result instead of sending twice", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake);
    const approval = seedApproval(fake);
    const sendSpy = vi.spyOn(GmailProvider.prototype, "sendMessage").mockResolvedValue({
      messageId: "message_1",
      threadId: "thread_1",
      labelIds: ["SENT"],
    });
    const service = new ApprovalExecutionService(asDb(fake));

    const first = await service.executeApprovedAction(currentWorkspace(), approval, "user_123");
    const second = await service.executeApprovedAction(currentWorkspace(), approval, "user_123");

    expect(first.status).toBe("executed");
    expect(second.status).toBe("executed");
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({
      output: {
        messageId: "message_1",
        threadId: "thread_1",
        labelIds: ["SENT"],
      },
    });
  });

  it("does not double-send when duplicate execution arrives during an active Gmail send", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake);
    const approval = seedApproval(fake);
    let markStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let resolveSend: ((value: { messageId: string; threadId: string; labelIds: string[] }) => void) | null = null;
    const sendSpy = vi.spyOn(GmailProvider.prototype, "sendMessage").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
          markStarted?.();
        }),
    );
    const service = new ApprovalExecutionService(asDb(fake));

    const firstExecution = service.executeApprovedAction(currentWorkspace(), approval, "user_123");
    await started;
    const secondExecution = await service.executeApprovedAction(currentWorkspace(), approval, "user_123");

    expect(secondExecution.status).toBe("executing");
    expect(sendSpy).toHaveBeenCalledTimes(1);

    if (!resolveSend) {
      throw new Error("Expected Gmail send promise to be waiting.");
    }

    const releaseSend: (value: { messageId: string; threadId: string; labelIds: string[] }) => void = resolveSend;
    releaseSend({
      messageId: "message_2",
      threadId: "thread_1",
      labelIds: ["SENT"],
    });

    const firstResult = await firstExecution;
    expect(firstResult.status).toBe("executed");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("stores failed execution cleanly and allows an explicit retry", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake);
    const approval = seedApproval(fake);
    const sendSpy = vi.spyOn(GmailProvider.prototype, "sendMessage")
      .mockRejectedValueOnce(new Error("temporary gmail failure"))
      .mockResolvedValueOnce({
        messageId: "message_retry",
        threadId: "thread_1",
        labelIds: ["SENT"],
      });
    const executionService = new ApprovalExecutionService(asDb(fake));
    const approvalService = new ApprovalService(asDb(fake));

    await expect(
      executionService.executeApprovedAction(currentWorkspace(), approval, "user_123"),
    ).rejects.toThrow("temporary gmail failure");

    const failedApproval = fake.read("workspaces/ws_test/approvals/approval_1");
    expect(failedApproval?.["status"]).toBe("failed");
    expect(failedApproval?.["executionAttempts"]).toBe(1);

    await approvalService.retry(currentWorkspace().workspace, approval.id, "user_123");
    const retried = await executionService.executeApprovedAction(
      currentWorkspace(),
      approval,
      "user_123",
      { retry: true },
    );

    expect(retried.status).toBe("executed");
    expect(sendSpy).toHaveBeenCalledTimes(2);
    const storedApproval = fake.read("workspaces/ws_test/approvals/approval_1");
    expect(storedApproval?.["status"]).toBe("executed");
    expect(storedApproval?.["executionAttempts"]).toBe(2);
    expect(storedApproval?.["externalActionId"]).toBe("message_retry");
  });

  it("does not update HubSpot twice when duplicate execution arrives during an active update", async () => {
    const fake = new FakeFirestore();
    seedHubSpotConnection(fake);
    const approval = seedApproval(fake, {
      type: "crm_update",
      riskLevel: "high",
      title: "Update HubSpot company",
      proposedAction: {
        toolName: "hubspot.updateApproved",
        actionType: "hubspot_update",
        input: {
          module: "companies",
          recordId: "company_1",
          updates: { industry: "AI" },
        },
        requiresApproval: true,
        riskLevel: "high",
      },
    });
    vi.spyOn(HubSpotProvider.prototype, "getConnectionStatus").mockResolvedValue({ status: "connected" });
    let markStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let resolveUpdate:
      | ((value: { id: string; properties: Record<string, string>; updatedAt: string; archived: boolean }) => void)
      | null = null;
    const updateSpy = vi.spyOn(HubSpotProvider.prototype, "updateRecord").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
          markStarted?.();
        }),
    );
    const service = new ApprovalExecutionService(asDb(fake));

    const firstExecution = service.executeApprovedAction(currentWorkspace(), approval, "user_123");
    await started;
    const secondExecution = await service.executeApprovedAction(currentWorkspace(), approval, "user_123");

    expect(secondExecution.status).toBe("executing");
    expect(updateSpy).toHaveBeenCalledTimes(1);

    if (!resolveUpdate) {
      throw new Error("Expected HubSpot update promise to be pending.");
    }

    const releaseUpdate:
      (value: { id: string; properties: Record<string, string>; updatedAt: string; archived: boolean }) => void =
      resolveUpdate;
    releaseUpdate({
      id: "company_1",
      properties: { industry: "AI" },
      updatedAt: "2026-05-18T10:00:00.000Z",
      archived: false,
    });

    const firstResult = await firstExecution;
    expect(firstResult.status).toBe("executed");
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it("blocks HubSpot execution when the workspace connection is missing", async () => {
    const fake = new FakeFirestore();
    const approval = seedApproval(fake, {
      type: "crm_update",
      riskLevel: "high",
      title: "Update HubSpot contact",
      proposedAction: {
        toolName: "hubspot.updateApproved",
        actionType: "hubspot_update",
        input: {
          module: "contacts",
          recordId: "contact_1",
          updates: { firstname: "Alex" },
        },
        requiresApproval: true,
        riskLevel: "high",
      },
    });

    await expect(
      new ApprovalExecutionService(asDb(fake)).executeApprovedAction(
        currentWorkspace(),
        approval,
        "user_123",
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
