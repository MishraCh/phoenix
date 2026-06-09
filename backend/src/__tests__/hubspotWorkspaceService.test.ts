import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { env } from "../config/env.js";
import { IntegrationService } from "../integrations/integrationService.js";
import { IntegrationWorkspaceService } from "../integrations/integrationWorkspaceService.js";
import { HubSpotProvider } from "../integrations/providers/hubspot/hubspotProvider.js";
import { workflowRunSchema, workflowSchema, type Integration } from "../schemas/coreSchemas.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { WorkflowService } from "../workflows/workflowService.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

vi.mock("../ai/providers/providerRegistry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ai/providers/providerRegistry.js")>();

  return {
    ...actual,
    createLlmProvider: () => ({
      generateStructured: vi.fn(async (input: { schema: { parse(value: unknown): unknown }; userPrompt?: string }) =>
        input.schema.parse(
          input.userPrompt?.includes("Summarize this HubSpot record")
            ? {
                summary: "Healthy account with a clear next step.",
                keyPoints: ["Primary contact is engaged", "Opportunity is active"],
                nextSteps: ["Confirm timeline"],
              }
            : {
                subject: "Following up on our next CRM step",
                body: "Wanted to share a quick follow-up grounded in the selected CRM record.",
                rationale: "Based on the selected HubSpot context.",
              },
        ),
      ),
    }),
  };
});

function asDb(fake: FakeFirestore) {
  return fake as unknown as Firestore;
}

function currentWorkspace(
  userId = "user_member",
  role: "owner" | "admin" | "member" = userId === "user_owner" ? "owner" : "member",
): CurrentWorkspace {
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
      role,
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    role,
  };
}

function seedHubSpotConnection(fake: FakeFirestore, overrides: Record<string, unknown> = {}): Integration {
  const now = Timestamp.now();
  const integration = {
    id: "hubspot",
    workspaceId: "ws_test",
    provider: "hubspot",
    status: "connected",
    scopes: [],
    scopesGranted: [],
    tokenRef: "workspaces/ws_test/integrations/hubspot",
    capabilities: ["crm.read", "crm.write"],
    syncError: null,
    connectedBy: "user_owner",
    ownedByUserId: "user_owner",
    syncStatus: "idle",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } satisfies Record<string, unknown>;
  fake.seed("workspaces/ws_test/integrations/hubspot", integration);
  return integration as unknown as Integration;
}

function sampleContactRecord(recordId = "contact_1") {
  return {
    id: recordId,
    properties: {
      firstname: "Alex",
      lastname: "Founder",
      email: "alex@example.com",
      company: "Acme",
    },
    createdAt: "2026-05-18T09:00:00.000Z",
    updatedAt: "2026-05-18T10:00:00.000Z",
    archived: false,
  };
}

describe("HubSpot workspace hardening", () => {
  const originalWorkerPolling = env.WORKER_POLLING_ENABLED;

  beforeEach(() => {
    vi.restoreAllMocks();
    env.WORKER_POLLING_ENABLED = originalWorkerPolling;
    vi.spyOn(HubSpotProvider.prototype, "getRelatedRecords").mockResolvedValue([]);
  });

  it("allows workspace members to read HubSpot data and create CRM update approvals", async () => {
    const fake = new FakeFirestore();
    seedHubSpotConnection(fake);
    vi.spyOn(HubSpotProvider.prototype, "getConnectionStatus").mockResolvedValue({ status: "connected" });
    const searchSpy = vi.spyOn(HubSpotProvider.prototype, "searchRecords").mockResolvedValue([
      {
        id: "contact_1",
        title: "Alex Founder",
        subtitle: "alex@example.com",
        properties: { firstname: "Alex", lastname: "Founder", email: "alex@example.com" },
        updatedAt: "2026-05-18T10:00:00.000Z",
      },
    ]);
    vi.spyOn(HubSpotProvider.prototype, "getRecord").mockResolvedValue(sampleContactRecord());

    const service = new IntegrationWorkspaceService(asDb(fake));
    const workspace = currentWorkspace("user_member");

    const list = await service.getWorkspaceData(workspace, "user_member", "hubspot", {
      module: "contacts",
      query: "alex",
    });
    expect(list.list).toHaveLength(1);
    expect(searchSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      objectType: "contacts",
      query: "alex",
    }));

    const detail = await service.getSelectedItemDetail(workspace, "user_member", "hubspot", {
      itemId: "contact_1",
      module: "contacts",
    });
    expect(detail.contextBundleId).toBeTruthy();
    expect(detail.selectedContext.title).toBe("Alex Founder");

    const approval = await service.prepareHubSpotUpdateApproval(workspace, "user_member", {
      module: "contacts",
      recordId: "contact_1",
      updates: { jobtitle: "CEO" },
      title: "Promote contact title",
    });

    expect(approval.approvalId).toBeTruthy();
    const approvalDoc = fake.read(`workspaces/ws_test/approvals/${approval.approvalId}`);
    expect(approvalDoc?.["proposedAction"]).toMatchObject({
      toolName: "hubspot.updateApproved",
      actionType: "hubspot_update",
      requiresApproval: true,
    });
  });

  it("resolves a single HubSpot contact deterministically from live CRM search", async () => {
    const fake = new FakeFirestore();
    seedHubSpotConnection(fake);
    vi.spyOn(HubSpotProvider.prototype, "getConnectionStatus").mockResolvedValue({ status: "connected" });
    vi.spyOn(HubSpotProvider.prototype, "searchRecords").mockResolvedValue([
      {
        id: "contact_1",
        title: "Maria Johnson",
        subtitle: "maria@example.com",
        properties: { firstname: "Maria", lastname: "Johnson", email: "maria@example.com" },
        updatedAt: "2026-05-18T10:00:00.000Z",
      },
    ]);

    const result = await new IntegrationWorkspaceService(asDb(fake)).resolveHubSpotRecord(
      currentWorkspace("user_member"),
      "user_member",
      {
        module: "contacts",
        query: "Maria Johnson",
      },
    );

    expect(result).toMatchObject({
      status: "resolved_single",
      module: "contacts",
    });
  });

  it("returns multiple matches instead of guessing a HubSpot contact", async () => {
    const fake = new FakeFirestore();
    seedHubSpotConnection(fake);
    vi.spyOn(HubSpotProvider.prototype, "getConnectionStatus").mockResolvedValue({ status: "connected" });
    vi.spyOn(HubSpotProvider.prototype, "searchRecords").mockResolvedValue([
      {
        id: "contact_1",
        title: "Maria Johnson",
        subtitle: "maria@example.com",
        properties: { firstname: "Maria", lastname: "Johnson", email: "maria@example.com" },
        updatedAt: "2026-05-18T10:00:00.000Z",
      },
      {
        id: "contact_2",
        title: "Maria Johnson",
        subtitle: "maria@otherco.com",
        properties: { firstname: "Maria", lastname: "Johnson", email: "maria@otherco.com" },
        updatedAt: "2026-05-18T10:02:00.000Z",
      },
    ]);

    const result = await new IntegrationWorkspaceService(asDb(fake)).resolveHubSpotRecord(
      currentWorkspace("user_member"),
      "user_member",
      {
        module: "contacts",
        query: "Maria Johnson",
      },
    );

    expect(result).toMatchObject({
      status: "multiple_matches",
      module: "contacts",
    });
  });

  it("returns not_found when a HubSpot contact lookup has no matches", async () => {
    const fake = new FakeFirestore();
    seedHubSpotConnection(fake);
    vi.spyOn(HubSpotProvider.prototype, "getConnectionStatus").mockResolvedValue({ status: "connected" });
    vi.spyOn(HubSpotProvider.prototype, "searchRecords").mockResolvedValue([]);

    const result = await new IntegrationWorkspaceService(asDb(fake)).resolveHubSpotRecord(
      currentWorkspace("user_member"),
      "user_member",
      {
        module: "contacts",
        query: "Unknown Person",
      },
    );

    expect(result).toMatchObject({
      status: "not_found",
      module: "contacts",
    });
  });

  it("returns HubSpot summaries with source refs and selected-record context bundle ids", async () => {
    const fake = new FakeFirestore();
    seedHubSpotConnection(fake);
    vi.spyOn(HubSpotProvider.prototype, "getConnectionStatus").mockResolvedValue({ status: "connected" });
    vi.spyOn(HubSpotProvider.prototype, "getRecord").mockResolvedValue(sampleContactRecord());

    const result = await new IntegrationWorkspaceService(asDb(fake)).summarizeHubSpotRecord(
      currentWorkspace("user_member"),
      "user_member",
      {
        module: "contacts",
        recordId: "contact_1",
      },
    );

    expect(result.summary).toContain("Healthy account");
    expect(result.contextBundleId).toBeTruthy();
    expect(result.sourceRefs[0]).toMatchObject({
      provider: "hubspot",
      sourceId: "contact_1",
    });
  });

  it("purges cached HubSpot CRM data on disconnect but keeps user-created artifacts", async () => {
    const fake = new FakeFirestore();
    seedHubSpotConnection(fake);
    fake.seed("workspaces/ws_test/integrationItems/item_contact_1", {
      workspaceId: "ws_test",
      integrationId: "hubspot",
      provider: "hubspot",
      sourceType: "crm_contact",
      externalId: "contact_1",
      title: "Alex Founder",
      summary: "alex@example.com",
      normalizedData: sampleContactRecord(),
      sourceHash: "hash_contact_1",
      lastSyncedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    fake.seed("workspaces/ws_test/embeddings/embed_1", {
      workspaceId: "ws_test",
      sourceType: "integration_item",
      sourceId: "item_contact_1",
      sourceHash: "hash_contact_1",
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-large",
      dimensions: 3,
      vector: [0.1, 0.2, 0.3],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    fake.seed("workspaces/ws_test/artifacts/artifact_1", {
      workspaceId: "ws_test",
      title: "Saved CRM brief",
      artifactType: "summary",
      textContent: "Keep this artifact.",
      sourceRefs: [],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    await new IntegrationService(asDb(fake)).disconnectIntegration(
      currentWorkspace("user_member"),
      "hubspot",
      "user_member",
    );

    expect(fake.read("workspaces/ws_test/integrationItems/item_contact_1")).toBeUndefined();
    expect(fake.read("workspaces/ws_test/embeddings/embed_1")).toBeUndefined();
    expect(fake.read("workspaces/ws_test/artifacts/artifact_1")).toBeTruthy();
    expect(fake.read("workspaces/ws_test/integrations/hubspot")?.["status"]).toBe("disconnected");
  });

  it("blocks HubSpot reads and CRM update approvals when the connection is disconnected", async () => {
    const fake = new FakeFirestore();
    seedHubSpotConnection(fake, { status: "disconnected" });
    vi.spyOn(HubSpotProvider.prototype, "getConnectionStatus").mockResolvedValue({
      status: "disconnected",
      reconnectReason: "HubSpot is disconnected.",
    });

    const service = new IntegrationWorkspaceService(asDb(fake));

    await expect(
      service.getSelectedItemDetail(currentWorkspace("user_member"), "user_member", "hubspot", {
        itemId: "contact_1",
        module: "contacts",
      }),
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      service.prepareHubSpotUpdateApproval(currentWorkspace("user_member"), "user_member", {
        module: "contacts",
        recordId: "contact_1",
        updates: { firstname: "Alex" },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("resumes and fails workflow runs cleanly around HubSpot approval execution", async () => {
    const fake = new FakeFirestore();
    const now = Timestamp.now();
    env.WORKER_POLLING_ENABLED = true;
    fake.seed("workspaces/ws_test/workflows/workflow_1", workflowSchema.parse({
      id: "workflow_1",
      workspaceId: "ws_test",
      name: "HubSpot follow-up",
      type: "custom",
      status: "active",
      trigger: { type: "manual" },
      steps: [
        {
          id: "step_update",
          type: "integration.action",
          name: "Prepare HubSpot update",
          order: 0,
          config: {
            provider: "hubspot",
            operation: "prepareUpdateApproval",
            targetType: "contacts",
            targetId: "contact_1",
            updates: { jobtitle: "CEO" },
          },
        },
        {
          id: "step_artifact",
          type: "artifact",
          name: "Save artifact",
          order: 1,
          config: {
            artifactType: "summary",
            contentSource: "previous_step",
          },
        },
      ],
      approvalPolicy: { default: "external_only" },
      notificationPolicy: { channel: "in_app" },
      version: 1,
      createdBy: "user_member",
      createdAt: now,
      updatedAt: now,
    }));
    fake.seed("workspaces/ws_test/workflowRuns/run_1", workflowRunSchema.parse({
      id: "run_1",
      workspaceId: "ws_test",
      workflowId: "workflow_1",
      status: "waiting_approval",
      currentStepId: "step_update",
      progress: [
        {
          stepId: "step_update",
          name: "Prepare HubSpot update",
          status: "waiting_approval",
          approvalId: "approval_1",
        },
        {
          stepId: "step_artifact",
          name: "Save artifact",
          status: "pending",
        },
      ],
      inputSnapshot: {},
      artifactIds: [],
      approvalIds: ["approval_1"],
      dedupeKey: "run_workflow:ws_test:workflow_1:run_1",
      startedAt: now,
      triggeredBy: "user",
      triggeredByUserId: "user_member",
    }));
    fake.seed("workspaces/ws_test/workflowRuns/run_2", workflowRunSchema.parse({
      id: "run_2",
      workspaceId: "ws_test",
      workflowId: "workflow_1",
      status: "waiting_approval",
      currentStepId: "step_update",
      progress: [
        {
          stepId: "step_update",
          name: "Prepare HubSpot update",
          status: "waiting_approval",
          approvalId: "approval_2",
        },
        {
          stepId: "step_artifact",
          name: "Save artifact",
          status: "pending",
        },
      ],
      inputSnapshot: {},
      artifactIds: [],
      approvalIds: ["approval_2"],
      dedupeKey: "run_workflow:ws_test:workflow_1:run_2",
      startedAt: now,
      triggeredBy: "user",
      triggeredByUserId: "user_member",
    }));

    const workflowService = new WorkflowService(asDb(fake));
    await workflowService.resumeAfterApproval(currentWorkspace("user_member").workspace, "run_1", "approval_1", "user_member");
    expect(fake.read("workspaces/ws_test/workflowRuns/run_1")).toMatchObject({
      status: "running",
    });

    await workflowService.failAfterApprovalExecutionError(
      currentWorkspace("user_member").workspace,
      "run_2",
      "approval_2",
      "user_member",
      "HubSpot update failed.",
    );
    expect(fake.read("workspaces/ws_test/workflowRuns/run_2")).toMatchObject({
      status: "failed",
      error: "HubSpot update failed.",
    });
  });
});
