export type ApiErrorResponse = {
  code: string;
  message: string;
  status: number;
  details?: unknown;
};

type ApiErrorOptions = ApiErrorResponse;

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor({ code, message, status, details }: ApiErrorOptions) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function toApiErrorResponse(error: ApiError): ApiErrorResponse {
  return {
    code: error.code,
    message: error.message,
    status: error.status,
    details: error.details,
  };
}
