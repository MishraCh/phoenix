import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { env } from "../config/env.js";
import { logger } from "../observability/logger.js";
import { workflowSchema } from "../schemas/coreSchemas.js";
import { computeNextRunAt } from "../workflows/workflowUtils.js";
import { WorkflowService } from "../workflows/workflowService.js";
import { processWorkflowRun } from "./workflowRunProcessor.js";

export class WorkflowScheduler {
  constructor(private readonly db: Firestore) {}

  async tick(): Promise<void> {
    const now = Timestamp.now();
    let snapshot;

    try {
      snapshot = await this.db
        .collectionGroup("workflows")
        .where("status", "==", "active")
        .where("trigger.type", "==", "schedule")
        .where("nextRunAt", "<=", now)
        .limit(20)
        .get();
    } catch (error) {
      logger.error("WorkflowScheduler: query failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (snapshot.empty) return;

    logger.info("WorkflowScheduler: processing due workflows", { count: snapshot.size });

    for (const doc of snapshot.docs) {
      try {
        const parsed = workflowSchema.safeParse({ id: doc.id, ...doc.data() });
        if (!parsed.success) {
          logger.warn("WorkflowScheduler: skipping malformed workflow document", { id: doc.id });
          continue;
        }

        const workflow = parsed.data;
        if (workflow.trigger.type !== "schedule") continue;

        const scheduledForAt = doc.data().nextRunAt as Timestamp;

        // Compute the next occurrence before advancing to prevent re-processing the same slot
        let nextTs: Timestamp;
        try {
          nextTs = Timestamp.fromDate(
            computeNextRunAt(workflow.trigger.cron, workflow.trigger.timezone),
          );
        } catch (cronError) {
          logger.warn("WorkflowScheduler: invalid cron expression, clearing nextRunAt", {
            workflowId: workflow.id,
            cron: workflow.trigger.cron,
          });
          await doc.ref.update({ nextRunAt: null });
          continue;
        }

        // Prevent overlapping scheduled runs
        const activeRunsSnap = await this.db
          .collection("workspaces")
          .doc(workflow.workspaceId)
          .collection("workflowRuns")
          .where("workflowId", "==", workflow.id)
          .where("triggeredBy", "==", "schedule")
          .where("status", "in", ["queued", "running"])
          .limit(1)
          .get();

        if (!activeRunsSnap.empty) {
          logger.warn("WorkflowScheduler: Skipping scheduled run; a previous scheduled run is still active", {
            workflowId: workflow.id,
            activeRunId: activeRunsSnap.docs[0]?.id,
          });

          await doc.ref.update({
            lastRunAt: scheduledForAt,
            nextRunAt: nextTs,
          });
          continue;
        }

        // Advance nextRunAt first so a second scheduler tick in the same minute does not re-fire
        await doc.ref.update({
          lastRunAt: scheduledForAt,
          nextRunAt: nextTs,
        });

        const service = new WorkflowService(this.db);
        await service.startScheduledRun(
          workflow.workspaceId,
          workflow.id,
          scheduledForAt.toDate(),
        );

        logger.info("WorkflowScheduler: scheduled run created", {
          workspaceId: workflow.workspaceId,
          workflowId: workflow.id,
          scheduledForAt: scheduledForAt.toDate().toISOString(),
          nextRunAt: nextTs.toDate().toISOString(),
        });
      } catch (error) {
        logger.error("WorkflowScheduler: failed to process workflow", {
          id: doc.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
