import { onRequest } from "firebase-functions/v2/https";
import { createApp } from "./app.js";
import { getFirebaseDb } from "./config/firebaseAdmin.js";
import { logger } from "./observability/logger.js";

const app = createApp();

// Export the Express app as a 2nd Gen Firebase Cloud Function
export const api = onRequest(
  { 
    region: "us-central1", 
    timeoutSeconds: 3600, // 60 minutes for long-running AI workflows
    memory: "1GiB"        // Adjust upwards if the AI orchestration requires more
  }, 
  app
);
