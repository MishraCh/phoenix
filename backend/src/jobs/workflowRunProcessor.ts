import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

import { publishEvent } from "../sse/eventBus.js";
import { ActivityService } from "../activity/activityService.js";
import { ApprovalService } from "../approvals/approvalService.js";
import { ArtifactService } from "../artifacts/artifactService.js";
import { MemoryService } from "../memory/memoryService.js";
import { NotificationService } from "../notifications/notificationService.js";
import { SmtpService } from "../services/smtpService.js";
import { MonitoredSourceRepository } from "../repositories/monitoredSourceRepository.js";
import { logger } from "../observability/logger.js";
import { workflowRunSchema, workflowSchema, workspaceSchema } from "../schemas/coreSchemas.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { IntegrationWorkspaceService } from "../integrations/integrationWorkspaceService.js";
import { WebIntelligenceService } from "../web/webIntelligenceService.js";
import { WorkflowExecutionService } from "../workflows/workflowExecutionService.js";
import {
  formatWorkflowStepContext,
  writeWorkflowStepOutput,
  type WorkflowStepOutput,
} from "../workflows/workflowStepOutput.js";
import { substituteInput } from "../workflows/workflowUtils.js";

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

async function loadWorkspaceForRun(db: Firestore, workspaceId: string, userId: string): Promise<CurrentWorkspace> {
  const wsSnap = await db.collection("workspaces").doc(workspaceId).get();

  if (!wsSnap.exists) {
    throw new Error(`Workspace ${workspaceId} not found.`);
  }

  const workspace = workspaceSchema.parse({ id: wsSnap.id, ...wsSnap.data() });
  const now = Timestamp.now();

  return {
    id: workspaceId,
    workspace,
    member: {
      userId,
      workspaceId,
      role: "admin",
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
    role: "admin",
  };
}

/**
 * Core workflow execution function. Idempotent — skips terminal runs.
 * Called directly from route handlers, scheduler, approval resume, and internal endpoint.
 * Handles all step types, SSE emission, approval pause/resume, cancellation, and Firestore updates.
 */
export async function processWorkflowRun(
  db: Firestore,
  { workspaceId, workflowId, runId }: { workspaceId: string; workflowId: string; runId: string },
): Promise<void> {
  const runRef = db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("workflowRuns")
    .doc(runId);

  const emitRun = (event: string, data: Record<string, unknown> = {}) => {
    publishEvent(
      [`workspace:${workspaceId}`, `run:${runId}`],
      event,
      { workspaceId, workflowId, runId, ...data, timestamp: new Date().toISOString() },
    );
  };

  try {
    // ── Idempotency guard ─────────────────────────────────────────────────────
    const runSnapshot = await runRef.get();

    if (!runSnapshot.exists) {
      throw new Error(`Workflow run ${runId} not found.`);
    }

    const run = workflowRunSchema.parse({ id: runSnapshot.id, ...runSnapshot.data() });

    if (TERMINAL_STATES.has(run.status)) {
      logger.info("processWorkflowRun: run already terminal, skipping", { runId, status: run.status });
      return;
    }

    // waiting_approval: only the resume path (which updates status to "running" before calling) should proceed
    if (run.status === "waiting_approval") {
      logger.info("processWorkflowRun: run is waiting_approval, skipping", { runId });
      return;
    }

    // Validate ownership
    if (run.workflowId !== workflowId) {
      throw new Error(`Run ${runId} belongs to workflow ${run.workflowId}, not ${workflowId}.`);
    }

    // ── Load workflow ─────────────────────────────────────────────────────────
    const workflowRef = db
      .collection("workspaces")
      .doc(workspaceId)
      .collection("workflows")
      .doc(workflowId);
    const workflowSnapshot = await workflowRef.get();

    const parsedWorkflow = workflowSnapshot.exists
      ? workflowSchema.parse({ id: workflowSnapshot.id, ...workflowSnapshot.data() })
      : null;
    const workflowSteps = parsedWorkflow?.steps ?? [];
    const workflowName =
      (workflowSnapshot.data() as Record<string, unknown> | undefined)?.name as string | undefined ?? null;

    // ── Bootstrap ─────────────────────────────────────────────────────────────
    const userId = run.triggeredByUserId ?? "system";
    const currentWorkspace = await loadWorkspaceForRun(db, workspaceId, userId);

    // Look up user email once at bootstrap so the notification step can send SMTP directly
    let userEmail: string | null = null;
    let userDisplayName: string | null = null;
    if (userId !== "system") {
      try {
        const userRecord = await getAuth().getUser(userId);
        userEmail = userRecord.email ?? null;
        userDisplayName = userRecord.displayName ?? null;
      } catch {
        // non-fatal — in-app notification will still work
      }
    }

    // Mark as running (idempotent — already running on resumed runs)
    if (run.status !== "running") {
      await runRef.update({ status: "running" });
    }

    emitRun("workflow.run.started", { workflowName });

    const activityService = new ActivityService(db);
    const notificationService = new NotificationService(db);

    const completedProgress = [...run.progress];
    const artifactIds: string[] = [...(run.artifactIds ?? [])];
    const inputSnapshot: Record<string, string> = Object.fromEntries(
      Object.entries(run.inputSnapshot ?? {}).map(([k, v]) => [k, String(v)]),
    );
    let anyMonitorChange = false;
    let lastStepOutput = "";
    let lastTypedStepOutput: WorkflowStepOutput | null = null;
    let lastStepSources: unknown[] = [];
    let lastContextOutput = "";
    let runFailed = false;
    let runFailedError: string | undefined;
    let approvalPaused = false;
    let runCancelled = false;
    let conditionalStopped = false;

    const loadStepOutput = async (stepId: string): Promise<WorkflowStepOutput | null> => {
      const snapshot = await runRef.collection("stepOutputs").doc(stepId).get();
      if (!snapshot.exists) return null;
      return snapshot.data() as WorkflowStepOutput;
    };

    const buildReferencedStepContext = async (inputStepIds: string[]) => {
      if (!inputStepIds.length) return "";
      const outputs = await Promise.all(inputStepIds.map((stepId) => loadStepOutput(stepId)));
      return outputs
        .map((output, index) => {
          const stepId = inputStepIds[index];
          return `Referenced workflow step ${stepId}:\n${formatWorkflowStepContext(output)}`;
        })
        .join("\n\n");
    };

    // ── Step execution loop ───────────────────────────────────────────────────
    for (let i = 0; i < completedProgress.length; i++) {
      const progressStep = completedProgress[i];
      const workflowStep = workflowSteps.find((step) => step.id === progressStep.stepId);
      const stepNow = Timestamp.now();

      // Skip terminal or already-paused steps — supports resume after approval
      if (["completed", "failed", "skipped", "waiting_approval"].includes(progressStep.status)) {
        lastStepOutput = progressStep.outputSummary ?? lastStepOutput;
        continue;
      }

      if (runFailed) {
        completedProgress[i] = {
          ...progressStep,
          status: "skipped",
          startedAt: stepNow,
          completedAt: stepNow,
          outputSummary: "Skipped: a previous step failed.",
        };
        continue;
      }

      if (conditionalStopped) {
        completedProgress[i] = {
          ...progressStep,
          status: "skipped",
          startedAt: stepNow,
          completedAt: stepNow,
          outputSummary: "Skipped: condition was not met.",
        };
        continue;
      }

      // Cancellation check before each step
      {
        const cancelCheckSnap = await runRef.get();
        const cancelCheckStatus = (cancelCheckSnap.data() as { status?: string } | undefined)?.status;
        if (cancelCheckStatus === "cancelled") {
          runCancelled = true;
          break;
        }
      }

      // Mark step running
      completedProgress[i] = { ...progressStep, status: "running", startedAt: stepNow };
      await runRef.update({ currentStepId: progressStep.stepId, progress: completedProgress });
      emitRun("workflow.step.started", { stepId: progressStep.stepId, stepType: workflowStep?.type ?? "unknown" });

      // ── monitor ──────────────────────────────────────────────────────────────
      if (workflowStep?.type === "monitor") {
        const targetType =
          (workflowStep.config.targetType as "url" | "keyword" | "company" | "person") ?? "url";
        const target = String(workflowStep.config.target ?? "");
        const objective =
          typeof workflowStep.config.objective === "string" ? workflowStep.config.objective : undefined;
        const processor =
          (workflowStep.config.processor as "base" | "core" | "pro" | "ultra" | undefined) ?? "core";
        const monitoredSourceId =
          typeof workflowStep.config.monitoredSourceId === "string"
            ? workflowStep.config.monitoredSourceId
            : undefined;

        let stepOutput = `Monitor check: ${targetType} "${target}"`;
        let stepStatus: "completed" | "failed" = "completed";
        let contentForNextStep = "";

        let typedOutputPayload: Record<string, unknown> = {};
        let typedOutputSummary = "";
        let typedOutputSourceRefs: unknown[] = [];
        let createdArtifactId: string | null = null;

        try {
          const webService = new WebIntelligenceService(db);
          const checkResult = await webService.monitorCheck({
            currentWorkspace,
            userId,
            targetType,
            target,
            objective,
            processor,
          });

          if (monitoredSourceId) {
            const monitorRepo = new MonitoredSourceRepository(db);
            await monitorRepo
              .update(workspaceId, monitoredSourceId, {
                lastCheckedAt: stepNow,
                lastContentHash: checkResult.currentContentHash,
                ...(checkResult.changed ? { lastChangedAt: stepNow } : {}),
              })
              .catch(() => undefined);
          }

          if (checkResult.changed) {
            anyMonitorChange = true;
            const contentText =
              checkResult.contentText ?? `Change detected for ${targetType} "${target}".`;
            contentForNextStep = contentText;

            const artifactService = new ArtifactService(db);
            const artifact = await artifactService.createArtifact({
              workspace: currentWorkspace.workspace,
              userId,
              title: `Monitor update: ${target}`,
              artifactType: "report",
              content: contentText,
              sourceRefs: checkResult.sourceRefs,
              inputHash: checkResult.currentContentHash,
              creationSource: "monitor",
              workflowId,
              workflowRunId: runId,
            });
            artifactIds.push(artifact.id);

            await notificationService.createNotification({
              workspaceId,
              userId,
              type: "report_ready",
              title: `Change detected: ${target}`,
              body: `A meaningful change was detected for monitored ${targetType} "${target}". A report has been saved to your Library.`,
              related: { artifactId: artifact.id, workflowId, workflowRunId: runId },
            });

            await activityService.createEvent({
              workspaceId,
              type: "web.monitor.changed",
              title: `Monitor change detected: ${targetType} "${target}"`,
              actorType: "system",
              related: { workflowId, workflowRunId: runId, artifactId: artifact.id },
              metadata: {
                targetType,
                target,
                provider: checkResult.provider,
                previousHash: checkResult.previousContentHash,
                currentHash: checkResult.currentContentHash,
                sourceCount: checkResult.sourceRefs.length,
                monitoredSourceId: monitoredSourceId ?? null,
              },
            });

            stepOutput = `Change detected. Report saved: ${artifact.id}`;
            createdArtifactId = artifact.id;
            typedOutputPayload = { contentText, changed: true, currentHash: checkResult.currentContentHash };
            typedOutputSummary = contentText.slice(0, 800);
            typedOutputSourceRefs = checkResult.sourceRefs;
          } else {
            await activityService.createEvent({
              workspaceId,
              type: "web.monitor.no_change",
              title: `Monitor check: no change — ${targetType} "${target}"`,
              actorType: "system",
              related: { workflowId, workflowRunId: runId },
              metadata: {
                targetType,
                target,
                provider: checkResult.provider,
                contentHash: checkResult.currentContentHash,
                monitoredSourceId: monitoredSourceId ?? null,
              },
            });

            stepOutput = `No change detected for ${targetType} "${target}".`;
            contentForNextStep = stepOutput;
            typedOutputPayload = { changed: false };
            typedOutputSummary = stepOutput;
          }

          const typedOutput = await writeWorkflowStepOutput(db, {
            workspaceId,
            workflowId,
            workflowRunId: runId,
            stepId: progressStep.stepId,
            outputKind: checkResult.changed ? "research" : "answer",
            schemaVersion: "workflow-step-output.v1",
            payload: typedOutputPayload,
            compactSummary: typedOutputSummary,
            sourceRefs: typedOutputSourceRefs,
            artifactIds: createdArtifactId ? [createdArtifactId] : [],
            approvalIds: [],
            status: "completed",
            retryCount: 0,
          });

          lastTypedStepOutput = typedOutput;
          lastStepSources = typedOutputSourceRefs;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Monitor check failed.";
          stepStatus = "failed";
          stepOutput = message;
          contentForNextStep = message;
        }

        completedProgress[i] = {
          ...completedProgress[i],
          status: stepStatus,
          completedAt: Timestamp.now(),
          outputSummary: stepOutput,
        };
        emitRun(
          stepStatus === "completed" ? "workflow.step.completed" : "workflow.step.failed",
          { stepId: progressStep.stepId, status: stepStatus },
        );
        lastStepOutput = contentForNextStep;

      // ── context ───────────────────────────────────────────────────────────────
      } else if (workflowStep?.type === "context") {
        const sources = Array.isArray(workflowStep.config.sources)
          ? (workflowStep.config.sources as string[])
          : ["memory"];
        const lines: string[] = [];
        let memoryCount = 0;

        try {
          if (sources.includes("memory")) {
            const memoryService = new MemoryService(db);
            const memNodes = await memoryService.listActive(currentWorkspace);
            memoryCount = memNodes.length;
            if (memNodes.length > 0) {
              lines.push("Workspace memory:");
              for (const node of memNodes.slice(0, 20)) {
                lines.push(`- [${node.type}] ${node.content}`);
              }
            }
          }

          if (sources.includes("artifacts")) {
            const artifactSnap = await db
              .collection("workspaces")
              .doc(workspaceId)
              .collection("artifacts")
              .orderBy("createdAt", "desc")
              .limit(5)
              .get();
            if (!artifactSnap.empty) {
              lines.push("\nRecent artifacts:");
              for (const doc of artifactSnap.docs) {
                const data = doc.data();
                const preview = String(data["textContent"] ?? "").slice(0, 200);
                lines.push(`- ${String(data["title"] ?? "Untitled")}: ${preview}`);
              }
            }
          }

          lastContextOutput = lines.join("\n") || "No context gathered.";
          lastStepOutput = lastContextOutput;

          completedProgress[i] = {
            ...completedProgress[i],
            status: "completed",
            completedAt: Timestamp.now(),
            outputSummary: `Context gathered from: ${sources.join(", ")} (${memoryCount} memory nodes)`,
          };
          emitRun("workflow.step.completed", { stepId: progressStep.stepId, status: "completed" });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Context step failed.";
          lastContextOutput = "";
          completedProgress[i] = {
            ...completedProgress[i],
            status: "failed",
            completedAt: Timestamp.now(),
            outputSummary: message,
            error: message,
          };
          emitRun("workflow.step.failed", { stepId: progressStep.stepId, error: message });
          runFailed = true;
          runFailedError = message;
        }

      // ── agent ─────────────────────────────────────────────────────────────────
      } else if (workflowStep?.type === "agent") {
        const agentId =
          typeof workflowStep.config.agentId === "string" ? workflowStep.config.agentId : null;
        const rawTask = String(workflowStep.config.task ?? "Perform the workflow task.");
        const task = String(substituteInput(rawTask, inputSnapshot));
        const contextBundleId =
          typeof workflowStep.config.contextBundleId === "string"
            ? workflowStep.config.contextBundleId
            : null;
        const referencedInputStepIds = Array.isArray(workflowStep.config.inputStepIds)
          ? workflowStep.config.inputStepIds.filter((stepId): stepId is string => typeof stepId === "string")
          : [];
        const referencedStepContext = await buildReferencedStepContext(referencedInputStepIds);
        let fallbackAllStepsContext = "";
        if (!referencedStepContext) {
          // If no explicit inputStepIds, proactively bundle all prior completed step outputs to prevent context loss
          const priorOutputPromises = completedProgress
            .slice(0, i)
            .map(p => loadStepOutput(p.stepId));
          const priorOutputs = await Promise.all(priorOutputPromises);
          fallbackAllStepsContext = priorOutputs
            .filter(Boolean)
            .map((output, idx) => `Step ${idx + 1} Output:\n${formatWorkflowStepContext(output)}`)
            .join("\n\n");
        }

        const fallbackStepContext = lastTypedStepOutput ? formatWorkflowStepContext(lastTypedStepOutput) : null;
        const extraContext =
          referencedStepContext ||
          fallbackAllStepsContext ||
          fallbackStepContext ||
          ([lastContextOutput || null, lastStepOutput || null]
            .filter(Boolean)
            .join("\n\n") || undefined);

        try {
          const execService = new WorkflowExecutionService(db);
          const result = await execService.runAgentStep({
            currentWorkspace,
            userId,
            agentId,
            stepInput: task,
            workflowId,
            workflowRunId: runId,
            stepId: progressStep.stepId,
            contextBundleId,
            extraContext,
          });

          if (result.createdArtifactId) {
            artifactIds.push(result.createdArtifactId);
          }

          const stepOutput =
            result.answer.length > 400 ? `${result.answer.slice(0, 397)}...` : result.answer;
          const typedOutput = await writeWorkflowStepOutput(db, {
            workspaceId,
            workflowId,
            workflowRunId: runId,
            stepId: progressStep.stepId,
            outputKind:
              result.resultKind === "expert"
                ? "expert"
                : result.resultKind === "research" || result.resultKind === "search"
                  ? "research"
                  : "answer",
            schemaVersion: "workflow-step-output.v1",
            payload: result.structuredPayload,
            compactSummary: result.compactSummary,
            sourceRefs: result.sourceRefs,
            artifactIds: result.createdArtifactId ? [result.createdArtifactId] : [],
            approvalIds: [],
            status: "completed",
            retryCount: 0,
          });

          completedProgress[i] = {
            ...completedProgress[i],
            status: "completed",
            completedAt: Timestamp.now(),
            outputSummary: stepOutput,
            outputRef: `workspaces/${workspaceId}/workflowRuns/${runId}/stepOutputs/${typedOutput.id}`,
          };
          emitRun("workflow.step.completed", { stepId: progressStep.stepId, status: "completed" });
          lastStepOutput = result.answer;
          lastTypedStepOutput = typedOutput;
          lastStepSources = result.sourceRefs;

          await activityService.createEvent({
            workspaceId,
            type: "workflow.agent_step_completed",
            title: `Agent step completed: ${workflowStep.name}`,
            actorType: "system",
            related: { workflowId, workflowRunId: runId },
            metadata: {
              agentId: agentId ?? null,
              stepId: progressStep.stepId,
              creditsCharged: result.creditsCharged,
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Agent step failed.";
          completedProgress[i] = {
            ...completedProgress[i],
            status: "failed",
            completedAt: Timestamp.now(),
            outputSummary: message,
            error: message,
          };
          emitRun("workflow.step.failed", { stepId: progressStep.stepId, error: message });
          lastStepSources = [];
          runFailed = true;
          runFailedError = message;
        }

      // ── artifact ──────────────────────────────────────────────────────────────
      } else if (workflowStep?.type === "artifact") {
        const configTitle =
          typeof workflowStep.config.title === "string" ? workflowStep.config.title : null;
        const configType =
          typeof workflowStep.config.artifactType === "string"
            ? workflowStep.config.artifactType
            : "workflow_output";
        const contentSource = String(workflowStep.config.contentSource ?? "previous_step");
        const staticContent =
          typeof workflowStep.config.content === "string" ? workflowStep.config.content : null;

        const apiTypeMap: Record<string, "report" | "draft" | "summary" | "data" | "document"> = {
          report: "report",
          draft: "draft",
          summary: "summary",
          data: "data",
          document: "document",
          research_report: "report",
          brief: "summary",
          workflow_output: "document",
          saved_insight: "data",
        };
        const apiArtifactType = apiTypeMap[configType] ?? "document";

        let content: string;
        if (contentSource === "static" && staticContent) {
          content = staticContent;
        } else if (contentSource === "run_summary") {
          content = completedProgress
            .slice(0, i)
            .map((s) => s.outputSummary)
            .filter(Boolean)
            .join("\n\n");
          if (!content) content = lastStepOutput || "No previous step output available.";
        } else {
          content = lastStepOutput || staticContent || "No content was available for this artifact.";
        }

        const title =
          configTitle ||
          (workflowStep.name !== "Artifact" ? workflowStep.name : null) ||
          `Workflow output — ${workflowId}`;

        try {
          const artifactService = new ArtifactService(db);
          const artifact = await artifactService.createArtifact({
            workspace: currentWorkspace.workspace,
            userId,
            title,
            artifactType: apiArtifactType,
            content,
            sourceRefs: lastStepSources,
            creationSource: "workflow_step",
            workflowId,
            workflowRunId: runId,
          });
          artifactIds.push(artifact.id);

          const stepOutput = `Artifact created: "${title}" (${apiArtifactType}) — ID: ${artifact.id}`;
          completedProgress[i] = {
            ...completedProgress[i],
            status: "completed",
            completedAt: Timestamp.now(),
            outputSummary: stepOutput,
          };
          emitRun("workflow.step.completed", { stepId: progressStep.stepId, status: "completed" });
          // Intentionally NOT overwriting lastStepOutput here, so that subsequent steps
          // (like notification) can still use the actual content rather than just seeing "Artifact created..."

          await activityService.createEvent({
            workspaceId,
            type: "workflow.artifact_step_completed",
            title: `Artifact created: ${title}`,
            actorType: "system",
            related: { workflowId, workflowRunId: runId, artifactId: artifact.id },
            metadata: { artifactType: apiArtifactType, stepId: progressStep.stepId },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Artifact step failed.";
          completedProgress[i] = {
            ...completedProgress[i],
            status: "failed",
            completedAt: Timestamp.now(),
            outputSummary: message,
            error: message,
          };
          emitRun("workflow.step.failed", { stepId: progressStep.stepId, error: message });
          runFailed = true;
          runFailedError = message;
        }

      // ── approval ──────────────────────────────────────────────────────────────
      } else if (workflowStep?.type === "approval") {
        const approvalTitle =
          typeof workflowStep.config.title === "string"
            ? workflowStep.config.title
            : workflowStep.name || "Workflow approval required";
        const reason =
          typeof workflowStep.config.reason === "string"
            ? workflowStep.config.reason
            : lastStepOutput || "A workflow step requires your approval before proceeding.";
        const riskLevel =
          (workflowStep.config.riskLevel as "low" | "medium" | "high" | "critical" | undefined) ??
          "medium";
        const actionType = String(workflowStep.config.actionType ?? "workflow_continue");

        const previewSource = workflowStep.config.previewSource ?? "previous_step";
        const preview: Record<string, unknown> =
          previewSource === "previous_step" && lastStepOutput
            ? { summary: lastStepOutput.slice(0, 500) }
            : { summary: String(workflowStep.config.preview ?? reason) };

        const idempotencyKey = `workflow_approval:${workflowId}:${runId}:${progressStep.stepId}`;

        try {
          const approvalService = new ApprovalService(db);
          const approval = await approvalService.createApproval({
            workspace: currentWorkspace.workspace,
            userId,
            title: approvalTitle,
            reason,
            type: "other",
            preview,
            proposedAction: {
              toolName: "workflow.continue",
              actionType,
              input: { workflowId, runId, stepId: progressStep.stepId },
              requiresApproval: true,
              riskLevel,
            },
            riskLevel,
            sourceRefs: [],
            idempotencyKey,
            workflowId,
            workflowRunId: runId,
          });

          completedProgress[i] = {
            ...completedProgress[i],
            status: "waiting_approval",
            outputSummary: `Waiting for approval: ${approvalTitle}`,
            approvalId: approval.id,
          };

          await runRef.update({
            status: "waiting_approval",
            currentStepId: progressStep.stepId,
            approvalIds: [...(run.approvalIds ?? []), approval.id],
            progress: completedProgress,
          });

          await activityService.createEvent({
            workspaceId,
            type: "workflow.approval_requested",
            title: `Approval requested: ${approvalTitle}`,
            actorType: "system",
            related: { workflowId, workflowRunId: runId, approvalId: approval.id },
            metadata: { riskLevel, stepId: progressStep.stepId },
          });

          await notificationService.createNotification({
            workspaceId,
            userId,
            type: "approval_needed",
            title: `Approval needed: ${approvalTitle}`,
            body: reason.slice(0, 300),
            related: { approvalId: approval.id, workflowId, workflowRunId: runId },
          });

          emitRun("workflow.waiting_approval", { approvalId: approval.id, stepId: progressStep.stepId });
          approvalPaused = true;
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Approval step failed.";
          completedProgress[i] = {
            ...completedProgress[i],
            status: "failed",
            completedAt: Timestamp.now(),
            outputSummary: message,
            error: message,
          };
          emitRun("workflow.step.failed", { stepId: progressStep.stepId, error: message });
          runFailed = true;
          runFailedError = message;
        }

      // ── notification ──────────────────────────────────────────────────────────
      } else if (workflowStep?.type === "notification") {
        const rawChannel = String(workflowStep.config.channel ?? "in_app");
        const channel = rawChannel === "email" ? "system_email" : rawChannel;
        const recipient = String(workflowStep.config.recipient ?? "workflow_owner");
        const customMessage =
          typeof workflowStep.config.message === "string" ? workflowStep.config.message : null;

        const title = workflowStep.name || "Workflow notification";
        const body = customMessage ?? (lastStepOutput ? lastStepOutput.slice(0, 300) : undefined);

        let stepOutput = "";

        try {
          // Always create an in-app notification (serves as the persistent record)
          await notificationService.createNotification({
            workspaceId,
            userId,
            type: "workflow_completed",
            title,
            body,
            related: { workflowId, workflowRunId: runId, stepId: progressStep.stepId, channel },
          });

          if (channel === "system_email") {
            if (recipient !== "workflow_owner") {
              throw new Error("System email notifications can only target the workflow owner.");
            }
            // Send a real SMTP email to the workspace owner.
            // Use full lastStepOutput (not the 300-char truncated body) so email has complete content.
            if (userEmail) {
              const workflowPageUrl = `/workflows`;
              const emailContent = customMessage ?? lastStepOutput;
              const sent = await SmtpService.sendWorkflowNotificationEmail(
                userEmail,
                title,
                emailContent,
                workflowPageUrl,
              );
              stepOutput = sent
                ? "Gideon notification emailed to the workflow owner and saved in-app."
                : "Notification saved in-app (system email delivery failed).";
              logger.info("Workflow system email notification completed", {
                workflowId,
                runId,
                stepId: progressStep.stepId,
                sent,
              });
              await activityService.createEvent({
                workspaceId,
                type: sent ? "workflow.system_email_sent" : "workflow.system_email_fallback",
                title: sent
                  ? "Workflow system email sent"
                  : "Workflow system email fell back to in-app notification",
                actorType: "system",
                related: { workflowId, workflowRunId: runId },
                metadata: { stepId: progressStep.stepId, reason: sent ? "sent" : "smtp_send_failed" },
              });
            } else {
              // User email not available (e.g. anonymous / system run) — fall back gracefully
              stepOutput = "Notification saved in-app (email not available for this user).";
              logger.warn("Workflow system email notification: user email not found, fell back to in-app", { userId, workflowId });
            }
          } else {
            stepOutput = "Notification delivered in-app.";
          }

          completedProgress[i] = {
            ...completedProgress[i],
            status: "completed",
            completedAt: Timestamp.now(),
            outputSummary: stepOutput,
          };
          emitRun("workflow.step.completed", { stepId: progressStep.stepId, status: "completed" });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Notification step failed.";
          completedProgress[i] = {
            ...completedProgress[i],
            status: "failed",
            completedAt: Timestamp.now(),
            outputSummary: message,
            error: message,
          };
          emitRun("workflow.step.failed", { stepId: progressStep.stepId, error: message });
          // Intentionally NOT overwriting lastStepOutput here to preserve pipeline state
        }

      // ── conditional ───────────────────────────────────────────────────────────
      } else if (workflowStep?.type === "conditional") {
        const condition = String(workflowStep.config.condition ?? "output_not_empty");
        const value =
          typeof workflowStep.config.value === "string" ? workflowStep.config.value : "";
        const onFalse = String(workflowStep.config.onFalse ?? "stop");

        let passed = false;
        let reason = "";

        switch (condition) {
          case "always":
            passed = true;
            reason = "Always passes.";
            break;
          case "output_not_empty":
            passed = lastStepOutput.trim().length > 0;
            reason = passed
              ? "Previous step produced output."
              : "Previous step output was empty.";
            break;
          case "monitor_changed":
            passed = anyMonitorChange;
            reason = passed ? "Monitor detected changes." : "No monitor changes detected.";
            break;
          case "output_contains":
            passed =
              value.length > 0 &&
              lastStepOutput.toLowerCase().includes(value.toLowerCase());
            reason = passed
              ? `Output contains "${value}".`
              : `Output does not contain "${value}".`;
            break;
          default:
            passed = lastStepOutput.trim().length > 0;
            reason = "Default: checking if previous step had output.";
        }

        const condOutput = `Condition "${condition}": ${passed ? "passed" : "failed"} — ${reason}`;
        completedProgress[i] = {
          ...completedProgress[i],
          status: "completed",
          completedAt: Timestamp.now(),
          outputSummary: condOutput,
        };
        emitRun("workflow.step.completed", { stepId: progressStep.stepId, status: "completed" });

        if (!passed && onFalse === "stop") {
          lastStepOutput = condOutput;
          conditionalStopped = true;
        }

      // ── fetch_url ─────────────────────────────────────────────────────────────
      } else if (workflowStep?.type === "fetch_url") {
        const url = String(workflowStep.config.url ?? "").trim();
        const objective =
          typeof workflowStep.config.objective === "string"
            ? workflowStep.config.objective
            : undefined;

        if (!url) {
          const message = "Fetch URL step: no URL configured.";
          completedProgress[i] = {
            ...completedProgress[i],
            status: "failed",
            completedAt: Timestamp.now(),
            outputSummary: message,
            error: message,
          };
          emitRun("workflow.step.failed", { stepId: progressStep.stepId, error: message });
          runFailed = true;
          runFailedError = message;
        } else {
          try {
            const webService = new WebIntelligenceService(db);
            const extracted = await webService.extractUrl({
              currentWorkspace,
              userId,
              urls: [url],
              objective,
              includeFullContent: true,
              activitySource: "system",
            });

            const content = extracted.contentText ?? "";
            const preview = content.replace(/\s+/g, " ").slice(0, 200);
            const summary = content.length > 200 ? `${preview}…` : preview || `Fetched: ${url}`;

            completedProgress[i] = {
              ...completedProgress[i],
              status: "completed",
              completedAt: Timestamp.now(),
              outputSummary: summary,
            };
            emitRun("workflow.step.completed", { stepId: progressStep.stepId, status: "completed" });
            lastStepOutput = content;
            lastStepSources = extracted.sourceRefs as unknown[];

            await activityService.createEvent({
              workspaceId,
              type: "web.extract.completed",
              title: `URL fetched: ${url}`,
              actorType: "system",
              related: { workflowId, workflowRunId: runId },
              metadata: { url, stepId: progressStep.stepId },
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : "Fetch URL step failed.";
            completedProgress[i] = {
              ...completedProgress[i],
              status: "failed",
              completedAt: Timestamp.now(),
              outputSummary: message,
              error: message,
            };
            emitRun("workflow.step.failed", { stepId: progressStep.stepId, error: message });
            runFailed = true;
            runFailedError = message;
          }
        }

      // ── integration.read ──────────────────────────────────────────────────────
      } else if (workflowStep?.type === "integration.read") {
        const provider = String(workflowStep.config.provider ?? "").trim();
        const targetType = String(workflowStep.config.targetType ?? "selected_item").trim();
        const targetId = String(workflowStep.config.targetId ?? "").trim();

        if (!provider || !targetId) {
          const message = "Integration read step requires provider and targetId.";
          completedProgress[i] = {
            ...completedProgress[i],
            status: "failed",
            completedAt: Timestamp.now(),
            outputSummary: message,
            error: message,
          };
          emitRun("workflow.step.failed", { stepId: progressStep.stepId, error: message });
          runFailed = true;
          runFailedError = message;
        } else {
          try {
            const integrationService = new IntegrationWorkspaceService(db);
            const module =
              targetType === "contacts" ||
              targetType === "companies" ||
              targetType === "deals" ||
              targetType === "notes" ||
              targetType === "tasks"
                ? targetType
                : undefined;
            const detail = await integrationService.getSelectedItemDetail(currentWorkspace, userId, provider, {
              itemId: targetId,
              module,
            });

            completedProgress[i] = {
              ...completedProgress[i],
              status: "completed",
              completedAt: Timestamp.now(),
              outputSummary: detail.selectedContext.summary || detail.selectedContext.title,
            };
            emitRun("workflow.step.completed", { stepId: progressStep.stepId, status: "completed" });
            lastStepOutput = detail.selectedContext.content;
            lastStepSources = detail.sourceRefs;
          } catch (err) {
            const message = err instanceof Error ? err.message : "Integration read step failed.";
            completedProgress[i] = {
              ...completedProgress[i],
              status: "failed",
              completedAt: Timestamp.now(),
              outputSummary: message,
              error: message,
            };
            emitRun("workflow.step.failed", { stepId: progressStep.stepId, error: message });
            runFailed = true;
            runFailedError = message;
          }
        }

      // ── integration.action ────────────────────────────────────────────────────
      } else if (workflowStep?.type === "integration.action") {
        const provider = String(workflowStep.config.provider ?? "").trim();
        const rawOperation = String(workflowStep.config.operation ?? workflowStep.config.actionType ?? "").trim();
        const operation = rawOperation === "send_email" ? "prepareSendApproval" : rawOperation;
        const targetType = String(workflowStep.config.targetType ?? "").trim();
        const targetId = String(workflowStep.config.targetId ?? "").trim();
        const requiresTargetId = !(provider === "gmail" && operation === "prepareSendApproval");

        if (!provider || !operation || (requiresTargetId && !targetId)) {
          const message = requiresTargetId
            ? "Integration action step requires provider, operation, and targetId."
            : "Integration action step requires provider and operation.";
          completedProgress[i] = {
            ...completedProgress[i],
            status: "failed",
            completedAt: Timestamp.now(),
            outputSummary: message,
            error: message,
          };
          emitRun("workflow.step.failed", { stepId: progressStep.stepId, error: message });
          runFailed = true;
          runFailedError = message;
        } else {
          try {
            const integrationService = new IntegrationWorkspaceService(db);
            const module =
              targetType === "contacts" ||
              targetType === "companies" ||
              targetType === "deals" ||
              targetType === "notes" ||
              targetType === "tasks"
                ? targetType
                : undefined;

            if (provider === "gmail" && operation === "summarizeThread") {
              const result = await integrationService.summarizeGmailThread(currentWorkspace, userId, targetId);
              completedProgress[i] = {
                ...completedProgress[i],
                status: "completed",
                completedAt: Timestamp.now(),
                outputSummary: result.summary,
              };
              emitRun("workflow.step.completed", { stepId: progressStep.stepId, status: "completed" });
              lastStepOutput = `${result.summary}\n\n- ${result.keyPoints.join("\n- ")}`;
              lastStepSources = result.sourceRefs;
            } else if (provider === "gmail" && operation === "prepareSendApproval") {
              const recipients = Array.isArray(workflowStep.config.recipients)
                ? (workflowStep.config.recipients as string[])
                : Array.isArray(workflowStep.config.to)
                  ? (workflowStep.config.to as string[])
                  : [];
              const subject =
                typeof workflowStep.config.subject === "string"
                  ? workflowStep.config.subject
                  : typeof workflowStep.config.subjectSourceStepId === "string"
                    ? workflowStep.name
                    : undefined;
              const body =
                typeof workflowStep.config.body === "string"
                  ? workflowStep.config.body
                  : typeof workflowStep.config.bodySourceStepId === "string"
                    ? lastStepOutput
                    : undefined;
              const approval = await integrationService.prepareGmailSendApproval(currentWorkspace, userId, {
                threadId: targetId || undefined,
                to: recipients,
                cc: Array.isArray(workflowStep.config.cc) ? (workflowStep.config.cc as string[]) : [],
                subject,
                body,
              });

              completedProgress[i] = {
                ...completedProgress[i],
                status: "waiting_approval",
                outputSummary: `Waiting for approval: Gmail send ${approval.subject}`,
                approvalId: approval.approvalId,
              };

              await runRef.update({
                status: "waiting_approval",
                currentStepId: progressStep.stepId,
                approvalIds: [...(run.approvalIds ?? []), approval.approvalId],
                progress: completedProgress,
              });
              await activityService.createEvent({
                workspaceId,
                type: "workflow.gmail_approval_created",
                title: "Workflow Gmail send approval created",
                actorType: "system",
                related: { workflowId, workflowRunId: runId, approvalId: approval.approvalId },
                metadata: { stepId: progressStep.stepId },
              });
              emitRun("workflow.waiting_approval", { approvalId: approval.approvalId, stepId: progressStep.stepId });
              approvalPaused = true;
              break;
            } else if (provider === "hubspot" && operation === "summarizeRecord" && module) {
              const result = await integrationService.summarizeHubSpotRecord(currentWorkspace, userId, {
                module,
                recordId: targetId,
              });
              completedProgress[i] = {
                ...completedProgress[i],
                status: "completed",
                completedAt: Timestamp.now(),
                outputSummary: result.summary,
              };
              emitRun("workflow.step.completed", { stepId: progressStep.stepId, status: "completed" });
              lastStepOutput = `${result.summary}\n\n- ${result.keyPoints.join("\n- ")}`;
              lastStepSources = result.sourceRefs;
            } else if (provider === "hubspot" && operation === "prepareUpdateApproval" && module) {
              if (module !== "contacts" && module !== "companies" && module !== "deals") {
                throw new Error(`HubSpot update approvals are not supported for module: ${module}`);
              }

              const approval = await integrationService.prepareHubSpotUpdateApproval(currentWorkspace, userId, {
                module,
                recordId: targetId,
                updates:
                  workflowStep.config.updates &&
                  typeof workflowStep.config.updates === "object" &&
                  !Array.isArray(workflowStep.config.updates)
                    ? (workflowStep.config.updates as Record<string, unknown>)
                    : {},
                title: typeof workflowStep.config.title === "string" ? workflowStep.config.title : undefined,
              });

              completedProgress[i] = {
                ...completedProgress[i],
                status: "waiting_approval",
                outputSummary: `Waiting for approval: HubSpot ${module} update`,
                approvalId: approval.approvalId,
              };

              await runRef.update({
                status: "waiting_approval",
                currentStepId: progressStep.stepId,
                approvalIds: [...(run.approvalIds ?? []), approval.approvalId],
                progress: completedProgress,
              });
              emitRun("workflow.waiting_approval", { approvalId: approval.approvalId, stepId: progressStep.stepId });
              approvalPaused = true;
              break;
            } else if (provider === "hubspot" && operation === "prepareCreateApproval" && module) {
              const approval = await integrationService.prepareHubSpotCreateApproval(currentWorkspace, userId, {
                module,
                properties:
                  workflowStep.config.properties &&
                  typeof workflowStep.config.properties === "object" &&
                  !Array.isArray(workflowStep.config.properties)
                    ? (workflowStep.config.properties as Record<string, unknown>)
                    : {},
                title: typeof workflowStep.config.title === "string" ? workflowStep.config.title : undefined,
              });

              completedProgress[i] = {
                ...completedProgress[i],
                status: "waiting_approval",
                outputSummary: `Waiting for approval: HubSpot ${module} create`,
                approvalId: approval.approvalId,
              };

              await runRef.update({
                status: "waiting_approval",
                currentStepId: progressStep.stepId,
                approvalIds: [...(run.approvalIds ?? []), approval.approvalId],
                progress: completedProgress,
              });
              emitRun("workflow.waiting_approval", { approvalId: approval.approvalId, stepId: progressStep.stepId });
              approvalPaused = true;
              break;
            } else if (provider === "hubspot" && operation === "prepareNoteApproval" && module && module !== "notes" && module !== "tasks") {
              const approval = await integrationService.prepareHubSpotNoteApproval(currentWorkspace, userId, {
                module,
                recordId: targetId,
                body: typeof workflowStep.config.body === "string" ? workflowStep.config.body : lastStepOutput || "Follow-up note from workflow.",
                title: typeof workflowStep.config.title === "string" ? workflowStep.config.title : undefined,
              });

              completedProgress[i] = {
                ...completedProgress[i],
                status: "waiting_approval",
                outputSummary: `Waiting for approval: HubSpot ${module} note`,
                approvalId: approval.approvalId,
              };

              await runRef.update({
                status: "waiting_approval",
                currentStepId: progressStep.stepId,
                approvalIds: [...(run.approvalIds ?? []), approval.approvalId],
                progress: completedProgress,
              });
              emitRun("workflow.waiting_approval", { approvalId: approval.approvalId, stepId: progressStep.stepId });
              approvalPaused = true;
              break;
            } else if (provider === "hubspot" && operation === "prepareTaskCreateApproval" && module && module !== "notes" && module !== "tasks") {
              const approval = await integrationService.prepareHubSpotTaskCreateApproval(currentWorkspace, userId, {
                module,
                recordId: targetId,
                subject: typeof workflowStep.config.subject === "string" ? workflowStep.config.subject : "Follow up",
                body: typeof workflowStep.config.body === "string" ? workflowStep.config.body : undefined,
                dueAt: typeof workflowStep.config.dueAt === "string" ? workflowStep.config.dueAt : undefined,
                status: typeof workflowStep.config.status === "string" ? workflowStep.config.status : undefined,
                priority: typeof workflowStep.config.priority === "string" ? workflowStep.config.priority : undefined,
                title: typeof workflowStep.config.title === "string" ? workflowStep.config.title : undefined,
              });

              completedProgress[i] = {
                ...completedProgress[i],
                status: "waiting_approval",
                outputSummary: `Waiting for approval: HubSpot ${module} task`,
                approvalId: approval.approvalId,
              };

              await runRef.update({
                status: "waiting_approval",
                currentStepId: progressStep.stepId,
                approvalIds: [...(run.approvalIds ?? []), approval.approvalId],
                progress: completedProgress,
              });
              emitRun("workflow.waiting_approval", { approvalId: approval.approvalId, stepId: progressStep.stepId });
              approvalPaused = true;
              break;
            } else if (provider === "hubspot" && operation === "prepareTaskUpdateApproval") {
              const approval = await integrationService.prepareHubSpotTaskUpdateApproval(currentWorkspace, userId, {
                recordId: targetId,
                updates:
                  workflowStep.config.updates &&
                  typeof workflowStep.config.updates === "object" &&
                  !Array.isArray(workflowStep.config.updates)
                    ? (workflowStep.config.updates as Record<string, unknown>)
                    : {},
                title: typeof workflowStep.config.title === "string" ? workflowStep.config.title : undefined,
              });

              completedProgress[i] = {
                ...completedProgress[i],
                status: "waiting_approval",
                outputSummary: "Waiting for approval: HubSpot task update",
                approvalId: approval.approvalId,
              };

              await runRef.update({
                status: "waiting_approval",
                currentStepId: progressStep.stepId,
                approvalIds: [...(run.approvalIds ?? []), approval.approvalId],
                progress: completedProgress,
              });
              emitRun("workflow.waiting_approval", { approvalId: approval.approvalId, stepId: progressStep.stepId });
              approvalPaused = true;
              break;
            } else if (provider === "hubspot" && operation === "prepareAssociationApproval" && module && module !== "notes" && module !== "tasks") {
              const relatedModule =
                workflowStep.config.relatedModule === "contacts" ||
                workflowStep.config.relatedModule === "companies" ||
                workflowStep.config.relatedModule === "deals" ||
                workflowStep.config.relatedModule === "notes" ||
                workflowStep.config.relatedModule === "tasks"
                  ? workflowStep.config.relatedModule
                  : "contacts";
              const approval = await integrationService.prepareHubSpotAssociationApproval(currentWorkspace, userId, {
                module,
                recordId: targetId,
                relatedModule,
                relatedRecordId: String(workflowStep.config.relatedRecordId ?? ""),
                action: workflowStep.config.action === "remove" ? "remove" : "add",
                title: typeof workflowStep.config.title === "string" ? workflowStep.config.title : undefined,
              });

              completedProgress[i] = {
                ...completedProgress[i],
                status: "waiting_approval",
                outputSummary: `Waiting for approval: HubSpot ${module} association`,
                approvalId: approval.approvalId,
              };

              await runRef.update({
                status: "waiting_approval",
                currentStepId: progressStep.stepId,
                approvalIds: [...(run.approvalIds ?? []), approval.approvalId],
                progress: completedProgress,
              });
              emitRun("workflow.waiting_approval", { approvalId: approval.approvalId, stepId: progressStep.stepId });
              approvalPaused = true;
              break;
            } else {
              const message = `Integration action "${operation}" is not implemented for provider "${provider}".`;
              completedProgress[i] = {
                ...completedProgress[i],
                status: "failed",
                completedAt: Timestamp.now(),
                outputSummary: message,
                error: message,
              };
              emitRun("workflow.step.failed", { stepId: progressStep.stepId, error: message });
              runFailed = true;
              runFailedError = message;
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : "Integration action step failed.";
            completedProgress[i] = {
              ...completedProgress[i],
              status: "failed",
              completedAt: Timestamp.now(),
              outputSummary: message,
              error: message,
            };
            emitRun("workflow.step.failed", { stepId: progressStep.stepId, error: message });
            runFailed = true;
            runFailedError = message;
          }
        }

      // ── unknown step type ─────────────────────────────────────────────────────
      } else {
        const typeName = workflowStep?.type ?? "unknown";
        const stepOutput = `Step type "${typeName}" is not yet implemented — step skipped.`;
        completedProgress[i] = {
          ...completedProgress[i],
          status: "completed",
          completedAt: Timestamp.now(),
          outputSummary: stepOutput,
        };
        emitRun("workflow.step.completed", { stepId: progressStep.stepId, status: "completed" });
        lastStepOutput = stepOutput;
      }

      // Flush step progress to Firestore (approval pause already flushed its own update)
      if (!approvalPaused) {
        await runRef.update({ progress: completedProgress });
      }
    }

    // ── Post-loop resolution ──────────────────────────────────────────────────

    // Approval pause: run is in waiting_approval — release cleanly
    if (approvalPaused) {
      return;
    }

    // Cancellation: run document already updated by cancelRun()
    if (runCancelled) {
      return;
    }

    const finalStatus = runFailed ? "failed" : "completed";
    let outputSummary: string;

    if (runFailed) {
      outputSummary = `Workflow failed: ${runFailedError ?? "unknown error"}`;
    } else if (conditionalStopped) {
      outputSummary = "Workflow stopped: condition was not met. Remaining steps skipped.";
    } else if (anyMonitorChange) {
      outputSummary =
        "Workflow completed. Monitor detected changes — report(s) saved to Library.";
    } else if (workflowSteps.some((step) => step.type === "monitor")) {
      outputSummary = "Workflow completed. Monitor check found no changes.";
    } else {
      outputSummary = lastStepOutput || "Workflow completed.";
    }

    await runRef.update({
      status: finalStatus,
      ...(runFailed ? { error: runFailedError } : {}),
      currentStepId: completedProgress.at(-1)?.stepId,
      progress: completedProgress,
      outputSummary,
      artifactIds,
      completedAt: Timestamp.now(),
    });
    emitRun(runFailed ? "workflow.run.failed" : "workflow.run.completed", { status: finalStatus });

    await activityService.createEvent({
      workspaceId,
      type: runFailed ? "workflow.run_failed" : "workflow.run_completed",
      title: runFailed ? "Workflow run failed" : "Workflow run completed",
      actorType: "system",
      related: { workflowId, workflowRunId: runId },
      metadata: { ...(runFailed ? { error: runFailedError } : {}) },
    });
  } catch (error) {
    // Top-level guard: handles unexpected failures (run not found, workspace not found, etc.)
    // Step-level failures are handled within the loop above and don't throw.
    const message = error instanceof Error ? error.message : "Workflow execution failed.";
    logger.error("processWorkflowRun: top-level failure", {
      workspaceId,
      workflowId,
      runId,
      error: message,
    });

    // Update run as failed in Firestore so it doesn't stay stuck in "running"
    try {
      await runRef.update({
        status: "failed",
        error: message,
        completedAt: Timestamp.now(),
      });
      emitRun("workflow.run.failed", { status: "failed", error: message });
    } catch (updateError) {
      logger.error("processWorkflowRun: failed to mark run as failed after top-level error", {
        runId,
        error: updateError instanceof Error ? updateError.message : String(updateError),
      });
    }

    throw error;
  }
}
