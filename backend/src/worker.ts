import { getFirebaseDb } from "./config/firebaseAdmin.js";
import { env } from "./config/env.js";
import { JobLockService } from "./jobs/jobLockService.js";
import { WorkerProcessor } from "./jobs/workerProcessor.js";
import { logger } from "./observability/logger.js";

import { WorkflowSchedulerService } from "./workflows/workflowSchedulerService.js";

const db = getFirebaseDb();

logger.info("Gideon worker process starting", {
  nodeEnv: env.NODE_ENV,
  localPolling: env.LOCAL_WORKER_POLLING,
  hasCloudTasks: !!env.GOOGLE_CLOUD_TASKS_QUEUE_PATH,
});

if (env.NODE_ENV === "production" && !env.GOOGLE_CLOUD_TASKS_QUEUE_PATH) {
  logger.error("FATAL: Running in production without GOOGLE_CLOUD_TASKS_QUEUE_PATH. Background jobs are disabled. Polling is strictly forbidden in production.");
} else if (env.GOOGLE_CLOUD_TASKS_QUEUE_PATH) {
  logger.info("Cloud Tasks configured. Worker will process jobs via secure webhooks. Polling disabled.");
} else if (env.LOCAL_WORKER_POLLING) {
  logger.info("Local worker polling ENABLED — starting job-lock poll loop");

  const jobLockService = new JobLockService(db);
  const workerProcessor = new WorkerProcessor(db);
  const schedulerService = new WorkflowSchedulerService(db);
  let polling = false;
  let pollingScheduler = false;

  const pollOnce = async () => {
    if (polling) return;
    polling = true;
    try {
      await jobLockService.resetStuckJobs();
      const jobs = await jobLockService.claimQueuedJobs(5);
      for (const job of jobs) {
        try {
          logger.info("Processing worker job via local poll", {
            dedupeKey: job.dedupeKey,
            jobType: job.jobType,
            workspaceId: job.workspaceId,
          });
          const result = await workerProcessor.process(job);
          await jobLockService.completeJob(job, result);
        } catch (error) {
          await jobLockService.failJob(job, error);
          logger.error("Worker job failed via local poll", {
            dedupeKey: job.dedupeKey,
            error: error instanceof Error ? error.message : error,
          });
        }
      }
    } catch (error) {
      logger.error("Worker local poll failed", { error: error instanceof Error ? error.message : error });
    } finally {
      polling = false;
    }
  };

  const pollSchedulerOnce = async () => {
    if (pollingScheduler) return;
    pollingScheduler = true;
    try {
      await schedulerService.pollAndDispatchDueWorkflows();
    } catch (error) {
      logger.error("Worker scheduler poll failed", { error: error instanceof Error ? error.message : error });
    } finally {
      pollingScheduler = false;
    }
  };

  void pollOnce();
  void pollSchedulerOnce();
  
  setInterval(() => { void pollOnce(); }, 5_000);
  setInterval(() => { void pollSchedulerOnce(); }, 60_000); // Poll workflows every minute
} else {
  logger.info("Worker polling DISABLED. Set LOCAL_WORKER_POLLING=true to test locally, or configure Cloud Tasks.");
}
