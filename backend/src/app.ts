import express from "express";

import { corsMiddleware } from "./observability/corsMiddleware.js";
import { errorHandler, notFoundHandler } from "./observability/errorHandler.js";
import { requestIdMiddleware } from "./observability/requestIdMiddleware.js";
import { requestLoggerMiddleware } from "./observability/requestLoggerMiddleware.js";
import { apiRouter } from "./routes/index.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(corsMiddleware);
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);
  app.use(apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
