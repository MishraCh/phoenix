import { CloudTasksClient } from "@google-cloud/tasks";
import { env } from "../config/env.js";
import { logger } from "../observability/logger.js";

let client: CloudTasksClient | null = null;

export function getCloudTasksClient() {
  if (!client) {
    client = new CloudTasksClient();
  }
  return client;
}

export type EnqueueWebhookTaskInput = {
  dedupeKey: string;
  jobType: string;
  workspaceId: string;
  runId?: string;
  workflowId?: string | null;
  agentId?: string | null;
};

export async function enqueueWorkerTask(payload: EnqueueWebhookTaskInput) {
  if (env.LOCAL_WORKER_POLLING) {
    logger.debug("Skipping Cloud Tasks enqueue because LOCAL_WORKER_POLLING is enabled.", { dedupeKey: payload.dedupeKey });
    return;
  }

  if (!env.GOOGLE_CLOUD_TASKS_QUEUE_PATH || !env.WORKER_WEBHOOK_URL) {
    logger.warn("Skipping Cloud Tasks enqueue: GOOGLE_CLOUD_TASKS_QUEUE_PATH or WORKER_WEBHOOK_URL not configured");
    return;
  }

  const tasksClient = getCloudTasksClient();
  const queuePath = env.GOOGLE_CLOUD_TASKS_QUEUE_PATH;

  // Cloud Tasks requires the task name to be formatted as: projects/P/locations/L/queues/Q/tasks/T
  // We sanitize the dedupeKey to meet task name requirements (letters, numbers, underscores, hyphens)
  const sanitizedTaskId = payload.dedupeKey.replace(/[^a-zA-Z0-9_-]/g, "-");
  const taskName = `${queuePath}/tasks/${sanitizedTaskId}`;

  try {
    const [response] = await tasksClient.createTask({
      parent: queuePath,
      task: {
        name: taskName,
        httpRequest: {
          httpMethod: "POST",
          url: env.WORKER_WEBHOOK_URL,
          headers: {
            "Content-Type": "application/json",
            ...(env.WORKER_TRIGGER_SECRET && { Authorization: `Bearer ${env.WORKER_TRIGGER_SECRET}` }),
          },
          body: Buffer.from(JSON.stringify(payload)).toString("base64"),
        },
      },
    });
    
    logger.info("Job payload pushed to Cloud Tasks", { dedupeKey: payload.dedupeKey, taskName: response.name });
  } catch (error: any) {
    // ALREADY_EXISTS (Code 6) means deduplication was successful
    if (error.code === 6) {
      logger.debug("Cloud Tasks deduplication hit (task already exists)", { dedupeKey: payload.dedupeKey });
      return;
    }
    logger.error("Failed to push job to Cloud Tasks", { dedupeKey: payload.dedupeKey, error: error.message || error });
    throw error;
  }
}
