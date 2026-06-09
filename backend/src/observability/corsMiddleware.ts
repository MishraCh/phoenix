import type { NextFunction, Request, Response } from "express";

import { env } from "../config/env.js";

const defaultAllowedOrigins = new Set([
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
]);

function getAllowedOrigins() {
  const configuredOrigins = env.FRONTEND_ORIGIN?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configuredOrigins?.length) {
    return new Set(configuredOrigins);
  }

  return defaultAllowedOrigins;
}

export function corsMiddleware(request: Request, response: Response, next: NextFunction) {
  const origin = request.header("origin");
  const allowedOrigins = getAllowedOrigins();

  if (origin && allowedOrigins.has(origin)) {
    response.header("Access-Control-Allow-Origin", origin);
    response.header("Vary", "Origin");
  }

  response.header("Access-Control-Allow-Credentials", "true");
  response.header("Access-Control-Allow-Headers", "Authorization, Content-Type, x-worker-secret");
  response.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");

  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }

  next();
}
