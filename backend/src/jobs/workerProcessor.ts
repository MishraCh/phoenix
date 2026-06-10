import type { Firestore } from "firebase-admin/firestore";

import { ActivityService } from "../activity/activityService.js";
import { IntegrationSyncService } from "../integrations/integrationSyncService.js";
import { GmailSyncService } from "../integrations/providers/gmail/gmailSyncService.js";
import { NotificationService } from "../notifications/notificationService.js";
import type { JobLock } from "../schemas/coreSchemas.js";
import { processWorkflowRun } from "./workflowRunProcessor.js";
import { processExaWebset } from "./exaTaskProcessor.js";
import { ApprovalMemoryExtractionService } from "../memory/approvalMemoryExtractionService.js";

export class WorkerProcessor {
  private readonly activityService: ActivityService;
  private readonly integrationSyncService: IntegrationSyncService;
  private readonly notificationService: NotificationService;

  constructor(private readonly db: Firestore) {
    this.activityService = new ActivityService(db);
    this.integrationSyncService = new IntegrationSyncService(db);
    this.notificationService = new NotificationService(db);
  }

  async process(job: JobLock) {
    if (job.jobType === "run_workflow") {
      return this.processWorkflowJob(job);
    }

    if (job.jobType === "run_agent") {
      throw new Error(
        "Legacy run_agent jobs are no longer supported. Convert scheduled agent work to a workflow with an agent step.",
      );
    }

    if (job.jobType === "send_notification") {
      return this.processNotificationJob(job);
    }

    if (job.jobType === "sync_integration") {
      return this.processIntegrationSyncJob(job);
    }

    if (job.jobType === "gmail_delta_sync") {
      return this.processGmailDeltaSyncJob(job);
    }

    if (job.jobType === "hubspot_delta_sync") {
      return this.processHubspotDeltaSyncJob(job);
    }

    if (job.jobType === "extract_memory_from_approval") {
      return this.processMemoryExtractionJob(job);
    }

    if (job.jobType === "exa_webset_poll") {
      return processExaWebset(this.db, job);
    }

    throw new Error(`Unsupported job type: ${job.jobType}`);
  }

  private async processWorkflowJob(job: JobLock) {
    const workflowId = String(job.payload?.workflowId ?? "");
    const runId = job.runId ?? "";

    if (!workflowId || !runId) {
      throw new Error("run_workflow jobs require workflowId and runId.");
    }

    try {
      await processWorkflowRun(this.db, { workspaceId: job.workspaceId, workflowId, runId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      try {
        await this.notificationService.createNotification({
          workspaceId: job.workspaceId,
          type: "workflow_failed",
          title: "Workflow run failed",
          body: `A background workflow run encountered an error: ${errorMessage}`,
          related: { workflowId, runId },
        });
      } catch (notifyError) {
        // Log quietly so we don't swallow the original error if notification fails
        console.error("Failed to create workflow failure notification", notifyError);
      }
      throw error;
    }

    return { resultRef: `workspaces/${job.workspaceId}/workflowRuns/${runId}` };
  }

  private async processNotificationJob(job: JobLock) {
    const payload = job.payload?.input;
    const input: Record<string, unknown> =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const notification = await this.notificationService.createNotification({
      workspaceId: job.workspaceId,
      userId: typeof input.userId === "string" ? input.userId : undefined,
      type:
        typeof input.type === "string" &&
        ["approval_needed", "workflow_completed", "workflow_failed", "report_ready",
          "integration_error", "missing_context", "agent_needs_setup"].includes(input.type)
          ? (input.type as Parameters<typeof this.notificationService.createNotification>[0]["type"])
          : "missing_context",
      title: typeof input.title === "string" ? input.title : "System notification",
      body: typeof input.body === "string" ? input.body : undefined,
      related:
        input.related && typeof input.related === "object" && !Array.isArray(input.related)
          ? (input.related as Record<string, string>)
          : undefined,
    });

    await this.activityService.createEvent({
      workspaceId: job.workspaceId,
      type: "notification.job_completed",
      title: "Notification job completed",
      actorType: "system",
      related: {},
      metadata: { notificationId: notification.id, dedupeKey: job.dedupeKey },
    });

    return { resultRef: `workspaces/${job.workspaceId}/notifications/${notification.id}` };
  }

  private async processIntegrationSyncJob(job: JobLock) {
    const provider =
      typeof job.payload?.input === "object" && job.payload.input
        ? (job.payload.input as Record<string, unknown>).provider
        : null;

    if (provider !== "gmail" && provider !== "google" && provider !== "hubspot") {
      throw new Error(`Provider "${String(provider)}" is not supported for sync.`);
    }

    const result = await this.integrationSyncService.syncIntegration(
      job.workspaceId,
      String(provider),
      typeof job.payload?.userId === "string" ? job.payload.userId : undefined,
    );

    return { resultRef: `workspaces/${job.workspaceId}/integrations/${String(provider)}`, ...result };
  }

  private async processGmailDeltaSyncJob(job: JobLock) {
    const input =
      typeof job.payload?.input === "object" && job.payload.input
        ? (job.payload.input as Record<string, unknown>)
        : {};
    const connectionId = typeof input.connectionId === "string" ? input.connectionId : "gmail";
    const historyId = typeof input.historyId === "string" ? input.historyId : null;

    if (!historyId) {
      throw new Error("gmail_delta_sync jobs require a historyId.");
    }

    const result = await new GmailSyncService(this.db).processHistory(
      job.workspaceId,
      connectionId,
      historyId,
      typeof job.payload?.userId === "string" ? job.payload.userId : undefined,
    );

    return { resultRef: `workspaces/${job.workspaceId}/integrations/${connectionId}`, ...result };
  }

  private async processHubspotDeltaSyncJob(job: JobLock) {
    const input =
      typeof job.payload?.input === "object" && job.payload.input
        ? (job.payload.input as Record<string, unknown>)
        : {};

    const events = Array.isArray(input.events) ? (input.events as Array<Record<string, unknown>>) : [];
    const hubspotModules = Array.from(
      new Set(
        events
          .map((event) => String(event.subscriptionType ?? ""))
          .flatMap((subscriptionType) => {
            const normalized = subscriptionType.toLowerCase();
            const modules: Array<"contacts" | "companies" | "deals" | "notes" | "tasks"> = [];
            if (normalized.includes("contact")) modules.push("contacts");
            if (normalized.includes("company")) modules.push("companies");
            if (normalized.includes("deal")) modules.push("deals");
            if (normalized.includes("note")) modules.push("notes");
            if (normalized.includes("task")) modules.push("tasks");
            return modules;
          }),
      ),
    );

    const result = await this.integrationSyncService.syncIntegration(
      job.workspaceId,
      "hubspot",
      typeof job.payload?.userId === "string" ? job.payload.userId : undefined,
      hubspotModules.length ? { hubspotModules } : undefined,
    );

    return { resultRef: `workspaces/${job.workspaceId}/integrations/hubspot`, ...result };
  }

  private async processMemoryExtractionJob(job: JobLock) {
    const input =
      typeof job.payload?.input === "object" && job.payload.input
        ? (job.payload.input as Record<string, unknown>)
        : {};
        
    const approvalId = typeof input.approvalId === "string" ? input.approvalId : null;
    
    if (!approvalId) {
      throw new Error("extract_memory_from_approval jobs require an approvalId.");
    }

    const service = new ApprovalMemoryExtractionService(this.db);
    await service.processEditedApproval(job.workspaceId, approvalId);

    return { resultRef: `workspaces/${job.workspaceId}/approvals/${approvalId}` };
  }
}
