import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";

type RequestSchemaConfig = {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
};

export function validateRequest({
  body,
  params,
  query,
}: RequestSchemaConfig): RequestHandler {
  return (request: Request, _response: Response, next: NextFunction) => {
    try {
      if (body) {
        request.body = body.parse(request.body);
      }

      if (params) {
        request.params = params.parse(request.params) as Request["params"];
      }

      if (query) {
        Object.defineProperty(request, "query", {
          value: query.parse(request.query),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
