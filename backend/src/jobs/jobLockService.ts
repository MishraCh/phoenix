import { createHash } from "node:crypto";

import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

import { env } from "../config/env.js";
import { logger } from "../observability/logger.js";
import { jobLockSchema, type JobLock } from "../schemas/coreSchemas.js";
import { ApiError } from "../utils/apiError.js";

export type JobType = "run_workflow" | "send_notification" | "sync_integration" | "gmail_delta_sync" | "hubspot_delta_sync" | "extract_memory_from_approval";

export type EnqueueJobInput = {
  workspaceId: string;
  jobType: JobType;
  workflowId?: string | null;
  agentId?: string | null;
  runId?: string | null;
  userId?: string | null;
  input?: Record<string, unknown>;
  dedupeKey?: string;
};

function hashPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload ?? {})).digest("hex").slice(0, 16);
}

function buildDedupeKey(input: EnqueueJobInput) {
  if (input.dedupeKey) {
    return input.dedupeKey;
  }

  const target = input.workflowId ?? input.agentId ?? "workspace";
  const uniquePart = input.runId ?? hashPayload(input.input);
  return `${input.jobType}:${input.workspaceId}:${target}:${uniquePart}`;
}

export class JobLockService {
  constructor(private readonly db: Firestore) {}

  /**
   * Global job queue collection — single flat collection scanned by the worker.
   * Eliminates the O(N workspaces) fan-out read on every poll cycle.
   */
  private globalQueue() {
    return this.db.collection("jobQueue");
  }

  /**
   * Per-workspace mirror — kept for UI-facing reads (e.g. admin job status pages).
   * The worker no longer reads from this path.
   */
  private workspaceMirror(workspaceId: string) {
    return this.db.collection("workspaces").doc(workspaceId).collection("jobLocks");
  }

  async enqueueJob(input: EnqueueJobInput): Promise<JobLock> {
    const dedupeKey = buildDedupeKey(input);
    const globalRef = this.globalQueue().doc(dedupeKey);
    const mirrorRef = this.workspaceMirror(input.workspaceId).doc(dedupeKey);

    // Check global collection first (authoritative)
    const existing = await globalRef.get();

    if (existing.exists) {
      const existingJob = jobLockSchema.parse({ id: existing.id, ...existing.data() });

      // If the job is still active (queued or running), return it as-is — dedup is intentional
      if (existingJob.status === "queued" || existingJob.status === "running") {
        return existingJob;
      }

      // If the job already completed or failed, delete from both paths so a fresh one can be created
      await this.db.batch()
        .delete(globalRef)
        .delete(mirrorRef)
        .commit();
    }

    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000);
    const job = jobLockSchema.parse({
      id: dedupeKey,
      dedupeKey,
      workspaceId: input.workspaceId,
      jobType: input.jobType,
      status: "queued",
      runId: input.runId ?? undefined,
      payload: {
        workflowId: input.workflowId ?? null,
        agentId: input.agentId ?? null,
        userId: input.userId ?? null,
        input: input.input ?? {},
      },
      expiresAt,
    });

    // Write to both global queue and workspace mirror atomically
    await this.db.batch()
      .set(globalRef, job)
      .set(mirrorRef, job)
      .commit();

    logger.debug("Job enqueued in Firestore", { dedupeKey, jobType: input.jobType, workspaceId: input.workspaceId });

    if (env.GOOGLE_CLOUD_TASKS_QUEUE_PATH && env.WORKER_WEBHOOK_URL) {
      try {
        const { enqueueWorkerTask } = await import("./cloudTasksClient.js");
        await enqueueWorkerTask({
          dedupeKey: job.dedupeKey,
          jobType: job.jobType,
          workspaceId: job.workspaceId,
          runId: job.runId,
          workflowId: job.payload?.workflowId as string | undefined,
          agentId: job.payload?.agentId as string | undefined,
        });
      } catch (error) {
        // Enqueue failure shouldn't fail the firestore write since the worker polling loop acts as a fallback
        logger.error("Failed to enqueue job to Cloud Tasks, worker polling will pick it up", { dedupeKey, error: error instanceof Error ? error.message : error });
      }
    }

    return job;
  }

  /**
   * Claims up to `limit` queued jobs from the global jobQueue collection.
   * Single query regardless of how many workspaces exist — O(1) read cost.
   */
  async claimQueuedJobs(limit = 5): Promise<JobLock[]> {
    const queuedSnapshot = await this.globalQueue()
      .where("status", "==", "queued")
      .orderBy("expiresAt", "asc")
      .limit(limit)
      .get();

    const claimedJobs: JobLock[] = [];

    for (const jobDoc of queuedSnapshot.docs) {
      if (claimedJobs.length >= limit) break;

      const claimed = await this.db.runTransaction(async (transaction) => {
        const fresh = await transaction.get(jobDoc.ref);

        if (!fresh.exists) return null;

        const job = jobLockSchema.parse({ id: fresh.id, ...fresh.data() });

        if (job.status !== "queued") return null;

        const now = Timestamp.now();
        const update = { status: "running", startedAt: now };

        // Update global queue (authoritative)
        transaction.update(jobDoc.ref, update);

        // Mirror update to workspace subcollection for UI reads
        const mirrorRef = this.workspaceMirror(job.workspaceId).doc(job.id);
        transaction.update(mirrorRef, update);

        return {
          ...job,
          status: "running" as const,
          startedAt: now,
        };
      });

      if (claimed) {
        claimedJobs.push(claimed);
      }
    }

    return claimedJobs;
  }

  async completeJob(job: JobLock, update?: { runId?: string; resultRef?: string }) {
    const patch: Record<string, unknown> = {
      status: "completed",
      completedAt: Timestamp.now(),
    };

    if (update?.runId ?? job.runId) {
      patch.runId = update?.runId ?? job.runId;
    }

    if (update?.resultRef ?? job.resultRef) {
      patch.resultRef = update?.resultRef ?? job.resultRef;
    }

    // Update both global queue and workspace mirror
    await this.db.batch()
      .update(this.globalQueue().doc(job.id), patch)
      .update(this.workspaceMirror(job.workspaceId).doc(job.id), patch)
      .commit();
  }

  async failJob(job: JobLock, error: unknown) {
    const message = error instanceof Error ? error.message : "Job failed.";
    const patch = {
      status: "failed",
      resultRef: message,
      completedAt: Timestamp.now(),
    };

    // Update both global queue and workspace mirror
    await this.db.batch()
      .update(this.globalQueue().doc(job.id), patch)
      .update(this.workspaceMirror(job.workspaceId).doc(job.id), patch)
      .commit();
  }

  /**
   * Resets stuck running jobs back to queued or marks them failed after max attempts.
   * Reads from global jobQueue — single query, no workspace fan-out.
   */
  async resetStuckJobs(): Promise<void> {
    const tenMinutesAgo = Timestamp.fromMillis(Date.now() - 10 * 60 * 1000);

    const stuckSnapshot = await this.globalQueue()
      .where("status", "==", "running")
      .where("startedAt", "<", tenMinutesAgo)
      .limit(20)
      .get();

    if (stuckSnapshot.empty) return;

    for (const doc of stuckSnapshot.docs) {
      const job = jobLockSchema.parse({ id: doc.id, ...doc.data() });

      // Skip jobs linked to workflow runs awaiting approval — they are intentionally paused
      if (job.runId && job.jobType === "run_workflow") {
        const runSnap = await this.db
          .collection("workspaces")
          .doc(job.workspaceId)
          .collection("workflowRuns")
          .doc(job.runId)
          .get();

        if (runSnap.exists && runSnap.data()?.status === "waiting_approval") {
          continue;
        }
      }

      const attempts = (job.attempts ?? 0) + 1;

      if (attempts >= 3) {
        const patch = {
          status: "failed",
          resultRef: "Max retry attempts exceeded",
          completedAt: Timestamp.now(),
          attempts,
        };
        await this.db.batch()
          .update(doc.ref, patch)
          .update(this.workspaceMirror(job.workspaceId).doc(job.id), patch)
          .commit();
        logger.warn("Stuck job marked failed: max attempts reached", {
          jobId: job.id,
          workspaceId: job.workspaceId,
          jobType: job.jobType,
          attempts,
        });
      } else {
        const patch = {
          status: "queued",
          startedAt: FieldValue.delete(),
          attempts,
        };
        await this.db.batch()
          .update(doc.ref, patch)
          .update(this.workspaceMirror(job.workspaceId).doc(job.id), patch)
          .commit();
        logger.warn("Stuck job reset to queued", {
          jobId: job.id,
          workspaceId: job.workspaceId,
          jobType: job.jobType,
          attempts,
        });
      }
    }
  }

  assertSupportedJobType(jobType: string): asserts jobType is JobType {
    if (!["run_workflow", "send_notification", "sync_integration", "gmail_delta_sync", "hubspot_delta_sync", "extract_memory_from_approval"].includes(jobType)) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: "Unsupported worker job type.",
        status: 400,
      });
    }
  }
}
