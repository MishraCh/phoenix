import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

import { ApiError, toApiErrorResponse } from "../utils/apiError.js";
import { logger } from "./logger.js";

export const notFoundHandler = (
  request: Request,
  _response: Response,
  next: NextFunction,
) => {
  next(
    new ApiError({
      code: "NOT_FOUND",
      message: `Route not found: ${request.method} ${request.originalUrl}`,
      status: 404,
    }),
  );
};

export const errorHandler: ErrorRequestHandler = (
  error,
  request,
  response,
  _next,
) => {
  const normalizedError =
    error instanceof ZodError
      ? new ApiError({
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          status: 400,
          details: error.issues,
        })
      : error instanceof ApiError
        ? error
        : new ApiError({
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred.",
            status: 500,
          });

  const isClientError = normalizedError.status < 500;
  const logFn = isClientError ? logger.warn.bind(logger) : logger.error.bind(logger);
  logFn("Request failed", {
    code: normalizedError.code,
    method: request.method,
    path: request.originalUrl,
    requestId: request.requestId,
    statusCode: normalizedError.status,
    ...(isClientError ? {} : { stack: error instanceof Error ? error.stack : undefined }),
  });

  response.status(normalizedError.status).json(toApiErrorResponse(normalizedError));
};
