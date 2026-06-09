import { describe, expect, it, vi, beforeEach } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { WorkerProcessor } from "../jobs/workerProcessor.js";
import { NotificationService } from "../notifications/notificationService.js";
import * as workflowRunProcessor from "../jobs/workflowRunProcessor.js";

vi.mock("../notifications/notificationService.js");
vi.mock("../jobs/workflowRunProcessor.js");

describe("WorkerProcessor", () => {
  let db: Firestore;
  let processor: WorkerProcessor;

  beforeEach(() => {
    db = {} as Firestore;
    processor = new WorkerProcessor(db);
    vi.clearAllMocks();
  });

  it("should create a notification when processWorkflowRun fails", async () => {
    const error = new Error("Mock workflow failure");
    vi.spyOn(workflowRunProcessor, "processWorkflowRun").mockRejectedValueOnce(error);
    
    // Grab the mocked method
    const createNotificationMock = vi.fn().mockResolvedValue({ id: "note_1" });
    // @ts-expect-error accessing private property for testing
    vi.spyOn(processor.notificationService, "createNotification").mockImplementation(createNotificationMock);

    const job = {
      id: "job_1",
      workspaceId: "ws_1",
      jobType: "run_workflow" as const,
      dedupeKey: "dk_1",
      status: "running" as const,
      payload: { workflowId: "wf_1" },
      runId: "run_1",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      lastHeartbeatAt: Timestamp.now(),
      retryCount: 0,
      expiresAt: Timestamp.now(),
      attempts: 0,
    };

    await expect(processor.process(job)).rejects.toThrow("Mock workflow failure");

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      type: "workflow_failed",
      title: "Workflow run failed",
      body: "A background workflow run encountered an error: Mock workflow failure",
      related: { workflowId: "wf_1", runId: "run_1" },
    });
  });
});
