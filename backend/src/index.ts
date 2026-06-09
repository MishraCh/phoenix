import { createApp } from "./app.js";
import { getFirebaseDb } from "./config/firebaseAdmin.js";
import { env } from "./config/env.js";
import { logger } from "./observability/logger.js";
import { sseManager } from "./sse/sseManager.js";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info("Backend API server started", {
    environment: env.NODE_ENV,
    port: env.PORT,
  });

  // Warm the Firestore gRPC connection immediately on startup.
  // Without this, the first user request establishes the HTTP/2 channel,
  // adding ~1500ms to every Firestore call in that first request batch.
  void getFirebaseDb()
    .collection("_warmup")
    .limit(1)
    .get()
    .then(() => logger.debug("Firestore connection warmed"))
    .catch(() => undefined);
});

process.on("SIGTERM", () => {
  sseManager.closeAll();
});
