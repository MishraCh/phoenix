import { createHmac } from "node:crypto";

import { env } from "../../config/env.js";
import type { IntegrationProviderId } from "../../schemas/coreSchemas.js";
import { ApiError } from "../../utils/apiError.js";
import type { OAuthStatePayload } from "./integrationContracts.js";

function getStateSecret() {
  if (!env.INTEGRATION_STATE_SECRET) {
    throw new ApiError({
      code: "INTEGRATION_CONFIG_MISSING",
      message: "INTEGRATION_STATE_SECRET is required for OAuth state validation.",
      status: 500,
    });
  }

  return env.INTEGRATION_STATE_SECRET;
}

function signState(serialized: string) {
  return createHmac("sha256", getStateSecret()).update(serialized).digest("base64url");
}

export function createIntegrationOAuthState(payload: OAuthStatePayload) {
  const serialized = JSON.stringify(payload);
  const encoded = Buffer.from(serialized, "utf8").toString("base64url");
  return `${encoded}.${signState(serialized)}`;
}

export function parseIntegrationOAuthState(
  state: string,
  expectedProvider?: IntegrationProviderId,
): OAuthStatePayload {
  const [encoded, signature] = state.split(".");

  if (!encoded || !signature) {
    throw new ApiError({
      code: "INTEGRATION_STATE_INVALID",
      message: "Integration OAuth state is invalid.",
      status: 400,
    });
  }

  const serialized = Buffer.from(encoded, "base64url").toString("utf8");

  if (signState(serialized) !== signature) {
    throw new ApiError({
      code: "INTEGRATION_STATE_INVALID",
      message: "Integration OAuth state signature did not match.",
      status: 400,
    });
  }

  const parsed = JSON.parse(serialized) as OAuthStatePayload;

  if (expectedProvider && parsed.provider !== expectedProvider) {
    throw new ApiError({
      code: "INTEGRATION_STATE_INVALID",
      message: "Integration OAuth state did not match the expected provider.",
      status: 400,
    });
  }

  return parsed;
}
