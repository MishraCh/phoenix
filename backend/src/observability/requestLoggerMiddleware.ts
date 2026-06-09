import type { NextFunction, Request, Response } from "express";

import { logger } from "./logger.js";
import { setRequestTimingMetadata } from "./requestTiming.js";

export function requestLoggerMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const startedAt = performance.now();
  setRequestTimingMetadata(request, "route", request.originalUrl);

  response.on("finish", () => {
    if (request.path === "/health") return;

    const durationMs = Number((performance.now() - startedAt).toFixed(2));
    const isError = response.statusCode >= 400;
    const isSlow = durationMs > 2000;

    logger.info("Request completed", {
      durationMs,
      method: request.method,
      path: request.originalUrl,
      requestId: request.requestId,
      statusCode: response.statusCode,
      ...(isError || isSlow
        ? { timings: request.requestTiming?.phases, timingMeta: request.requestTiming?.metadata }
        : {}),
    });
  });

  next();
}
