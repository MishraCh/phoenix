import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { processWorkflowRun } from "../jobs/workflowRunProcessor.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

import { ActivityService } from "../activity/activityService.js";
import { NotificationService } from "../notifications/notificationService.js";
import { WebIntelligenceService } from "../web/webIntelligenceService.js";
import { WorkflowExecutionService } from "../workflows/workflowExecutionService.js";
import { IntegrationWorkspaceService } from "../integrations/integrationWorkspaceService.js";
import { MemoryService } from "../memory/memoryService.js";

// Mock external services that hit APIs or use complex Firestore queries not in FakeFirestore
vi.mock("../web/webIntelligenceService.js");
vi.mock("../workflows/workflowExecutionService.js");
vi.mock("../integrations/integrationWorkspaceService.js");
vi.mock("../activity/activityService.js");
vi.mock("../notifications/notificationService.js");
vi.mock("../memory/memoryService.js");
vi.mock("../sse/eventBus.js", () => ({ publishEvent: vi.fn() }));

function asDb(fake: FakeFirestore) {
  return fake as unknown as Firestore;
}

describe("WorkflowRunProcessor", () => {
  let fakeDb: FakeFirestore;
  let db: Firestore;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeDb = new FakeFirestore();
    db = asDb(fakeDb);

    // Seed the workspace
    fakeDb.seed("workspaces/ws_test", {
      name: "Test Workspace",
      ownerId: "user_1",
      plan: "pro",
      planSource: "system",
      monthlyCreditsLimit: 100,
      monthlyCreditsUsed: 0,
      billingCycleStartAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    // Mock ActivityService, NotificationService
    vi.spyOn(ActivityService.prototype, "createEvent").mockResolvedValue({ id: "act_1" } as any);
    vi.spyOn(NotificationService.prototype, "createNotification").mockResolvedValue({ id: "not_1" } as any);
  });

  it("should aggressively execute a complex workflow covering all step types", async () => {
    const workflowId = "wf_omni";
    const runId = "run_1";
    const now = Timestamp.now();

    // 1. Construct a comprehensive workflow with all step types
    fakeDb.seed(`workspaces/ws_test/workflows/${workflowId}`, {
      workspaceId: "ws_test",
      name: "Omnibus Workflow",
      type: "custom",
      triggerType: "manual",
      trigger: { type: "manual" },
      status: "active",
      approvalPolicy: {},
      notificationPolicy: {},
      version: 1,
      createdBy: "test_user",
      steps: [
        { id: "step_mon", name: "Monitor", type: "monitor", config: { targetType: "url", target: "https://example.com" }, order: 0 },
        { id: "step_url", name: "Fetch", type: "fetch_url", config: { url: "https://example.org" }, order: 1 },
        { id: "step_ctx", name: "Context", type: "context", config: { sources: ["memory"] }, order: 2 },
        { id: "step_agt", name: "Agent", type: "agent", config: { task: "Analyze data" }, order: 3 },
        { id: "step_art", name: "Artifact", type: "artifact", config: { artifactType: "report" }, order: 4 },
        { id: "step_cond", name: "Conditional", type: "conditional", config: { condition: "always", onFalse: "stop" }, order: 5 },
        { id: "step_not", name: "Notification", type: "notification", config: { channel: "in_app" }, order: 6 },
        { id: "step_read", name: "Integration Read", type: "integration.read", config: { provider: "hubspot", targetType: "contacts", targetId: "c_1" }, order: 7 },
        { id: "step_act", name: "Integration Action", type: "integration.action", config: { provider: "gmail", operation: "summarizeThread", targetId: "t_1" }, order: 8 },
        { id: "step_app", name: "Approval", type: "approval", config: { reason: "Need approval to finish" }, order: 9 }
      ],
      createdAt: now,
      updatedAt: now,
    });

    // 2. Initialize the run
    const progress = Array(10).fill(null).map((_, i) => {
      const stepIds = [
        "step_mon", "step_url", "step_ctx", "step_agt", "step_art",
        "step_cond", "step_not", "step_read", "step_act", "step_app"
      ];
      return { stepId: stepIds[i], name: `Step ${i}`, status: "pending" };
    });

    fakeDb.seed(`workspaces/ws_test/workflowRuns/${runId}`, {
      workspaceId: "ws_test",
      workflowId,
      status: "queued",
      progress,
      startedAt: now,
      triggeredBy: "user",
      createdAt: now,
      updatedAt: now,
    });

    // 3. Setup mocks for step execution
    
    // Monitor
    vi.spyOn(WebIntelligenceService.prototype, "monitorCheck").mockResolvedValue({
      changed: true,
      provider: "mock",
      sourceRefs: [],
      currentContentHash: "hash_new",
      previousContentHash: "hash_old",
      contentText: "Monitor content updated.",
      targetType: "url",
      target: "https://example.com",
    });

    // Fetch URL
    vi.spyOn(WebIntelligenceService.prototype, "extractUrl").mockResolvedValue({
      contentText: "Extracted URL text.",
      sourceRefs: [{ url: "https://example.org" }],
    } as any);

    // Context (mock MemoryService to avoid unsupported query)
    vi.spyOn(MemoryService.prototype, "listActive").mockResolvedValue([
      { id: "mem1", type: "fact", content: "Memory point 1", createdAt: now, updatedAt: now } as any
    ]);
    
    // Hack FakeFirestore for artifact context query which uses .orderBy
    // We will bypass it by not including "artifacts" in context sources (which we did).

    // Agent
    vi.spyOn(WorkflowExecutionService.prototype, "runAgentStep").mockResolvedValue({
      answer: "Agent processed the data perfectly.",
      creditsCharged: 1,
      createdArtifactId: null,
      sourceRefs: [],
      resultKind: "answer",
      structuredPayload: { kind: "answer", summary: "Agent processed the data perfectly." },
      compactSummary: "Agent processed the data perfectly.",
    });

    // Integration Read
    vi.spyOn(IntegrationWorkspaceService.prototype, "getSelectedItemDetail").mockResolvedValue({
      selectedContext: {
        provider: "hubspot",
        itemId: "c_1",
        itemType: "contact",
        title: "Hubspot Contact",
        summary: "Contact details",
        content: "Contact content details here",
        sourceRefs: [],
      },
      sourceRefs: [],
    } as any);

    // Integration Action
    vi.spyOn(IntegrationWorkspaceService.prototype, "summarizeGmailThread").mockResolvedValue({
      summary: "Gmail thread summary",
      keyPoints: ["Point 1", "Point 2"],
      sourceRefs: [],
      contextBundleId: "cb_1",
      suggestedReplyFocus: ["Respond affirmatively"],
    });

    // 4. Execute the processor
    await processWorkflowRun(db, { workspaceId: "ws_test", workflowId, runId });

    // 5. Assertions
    const runDoc = fakeDb.read(`workspaces/ws_test/workflowRuns/${runId}`);
    
    // The workflow should be paused at the approval step
    expect(runDoc?.status).toBe("waiting_approval");
    expect(runDoc?.currentStepId).toBe("step_app");

    const finalProgress = runDoc?.progress as any[];
    expect(finalProgress).toBeDefined();

    // Verify each step status and output
    expect(finalProgress[0].status).toBe("completed"); // Monitor
    expect(finalProgress[0].outputSummary).toContain("Change detected. Report saved:");

    expect(finalProgress[1].status).toBe("completed"); // Fetch URL
    expect(finalProgress[1].outputSummary).toBe("Extracted URL text.");

    expect(finalProgress[2].status).toBe("completed"); // Context
    expect(finalProgress[2].outputSummary).toContain("Context gathered");

    expect(finalProgress[3].status).toBe("completed"); // Agent
    expect(finalProgress[3].outputSummary).toBe("Agent processed the data perfectly.");

    expect(finalProgress[4].status).toBe("completed"); // Artifact
    expect(finalProgress[4].outputSummary).toContain("Artifact created:");

    expect(finalProgress[5].status).toBe("completed"); // Conditional
    expect(finalProgress[5].outputSummary).toContain("passed");

    expect(finalProgress[6].status).toBe("completed"); // Notification
    expect(finalProgress[6].outputSummary).toBe("Notification delivered in-app.");

    expect(finalProgress[7].status).toBe("completed"); // Integration Read
    expect(finalProgress[7].outputSummary).toBe("Contact details");

    expect(finalProgress[8].status).toBe("completed"); // Integration Action
    expect(finalProgress[8].outputSummary).toBe("Gmail thread summary");

    expect(finalProgress[9].status).toBe("waiting_approval"); // Approval
    expect(finalProgress[9].outputSummary).toContain("Waiting for approval");
  });

  it("should handle individual step failures gracefully and transition the run to failed", async () => {
    const workflowId = "wf_fail";
    const runId = "run_fail_1";
    const now = Timestamp.now();

    // 1. Construct a simple workflow that will fail
    fakeDb.seed(`workspaces/ws_test/workflows/${workflowId}`, {
      workspaceId: "ws_test",
      name: "Failing Workflow",
      type: "custom",
      triggerType: "manual",
      trigger: { type: "manual" },
      status: "active",
      approvalPolicy: {},
      notificationPolicy: {},
      version: 1,
      createdBy: "test_user",
      steps: [
        { id: "step_url", name: "Fetch", type: "fetch_url", config: { url: "https://example.org" }, order: 0 },
        { id: "step_agt", name: "Agent", type: "agent", config: { task: "Analyze data" }, order: 1 }
      ],
      createdAt: now,
      updatedAt: now,
    });

    // 2. Initialize the run
    fakeDb.seed(`workspaces/ws_test/workflowRuns/${runId}`, {
      workspaceId: "ws_test",
      workflowId,
      status: "queued",
      progress: [
        { stepId: "step_url", name: "Fetch", status: "pending" },
        { stepId: "step_agt", name: "Agent", status: "pending" }
      ],
      startedAt: now,
      triggeredBy: "user",
      createdAt: now,
      updatedAt: now,
    });

    // 3. Setup mocks for step execution
    vi.spyOn(WebIntelligenceService.prototype, "extractUrl").mockResolvedValue({
      contentText: "Extracted URL text.",
      sourceRefs: [{ url: "https://example.org" }],
    } as any);

    // Mock agent step to fail
    vi.spyOn(WorkflowExecutionService.prototype, "runAgentStep").mockRejectedValue(new Error("Agent encountered a fatal processing error."));

    // 4. Execute the processor
    await processWorkflowRun(db, { workspaceId: "ws_test", workflowId, runId });

    // 5. Assertions
    const runDoc = fakeDb.read(`workspaces/ws_test/workflowRuns/${runId}`);
    
    // The workflow should be marked as failed
    expect(runDoc?.status).toBe("failed");
    expect(runDoc?.error).toBe("Agent encountered a fatal processing error.");

    const finalProgress = runDoc?.progress as any[];
    expect(finalProgress).toBeDefined();

    // Verify step statuses
    expect(finalProgress[0].status).toBe("completed"); // Fetch URL
    expect(finalProgress[1].status).toBe("failed"); // Agent
    expect(finalProgress[1].error).toBe("Agent encountered a fatal processing error.");
  });
});
