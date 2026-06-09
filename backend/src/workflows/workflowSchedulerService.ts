import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { Cron } from "croner";

import { logger } from "../observability/logger.js";
import { workflowSchema } from "../schemas/coreSchemas.js";
import { WorkflowService } from "./workflowService.js";

export class WorkflowSchedulerService {
  constructor(private readonly db: Firestore) {}

  /**
   * Calculate the next runtime for a given cron string and timezone.
   */
  static getNextRunAt(cronExpression: string, timezone: string): Timestamp | null {
    try {
      const cron = new Cron(cronExpression, { timezone });
      const nextRun = cron.nextRun();
      if (!nextRun) return null;
      return Timestamp.fromDate(nextRun);
    } catch (err) {
      logger.error("WorkflowSchedulerService: invalid cron expression", { cronExpression, timezone, err });
      return null;
    }
  }

  /**
   * Polls the workflows collection for active scheduled workflows that are due to run.
   */
  async pollAndDispatchDueWorkflows() {
    try {
      const now = Timestamp.now();
      
      const snapshot = await this.db
        .collectionGroup("workflows")
        .where("status", "==", "active")
        .where("trigger.type", "==", "schedule")
        .where("nextRunAt", "<=", now)
        .limit(50)
        .get();

      if (snapshot.empty) {
        return;
      }

      const workflowService = new WorkflowService(this.db);
      const batch = this.db.batch();

      for (const doc of snapshot.docs) {
        try {
          const workflowData = doc.data();
          const workflow = workflowSchema.parse({ id: doc.id, ...workflowData });
          
          if (workflow.trigger.type !== "schedule") {
            continue; // TypeScript narrowing
          }

          const { cron, timezone } = workflow.trigger;
          
          logger.info("WorkflowSchedulerService: dispatching scheduled workflow", {
            workflowId: workflow.id,
            workspaceId: workflow.workspaceId,
            cron,
          });

          // Scheduled runs have their own attribution and idempotency path.
          await workflowService.startScheduledRun(
            workflow.workspaceId,
            workflow.id,
            now.toDate(),
          );

          // Calculate next run
          const nextRunAt = WorkflowSchedulerService.getNextRunAt(cron, timezone);
          
          // Update the workflow document
          batch.update(doc.ref, {
            nextRunAt,
            lastRunAt: now,
            updatedAt: Timestamp.now(),
          });
        } catch (err) {
          logger.error("WorkflowSchedulerService: error processing scheduled workflow", {
            workflowId: doc.id,
            err: err instanceof Error ? err.message : err,
          });
        }
      }

      await batch.commit();
    } catch (err) {
      logger.error("WorkflowSchedulerService: polling failed", {
        err: err instanceof Error ? err.message : err,
      });
    }
  }
}
