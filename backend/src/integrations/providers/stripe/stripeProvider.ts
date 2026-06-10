import Stripe from "stripe";
import type { Firestore } from "firebase-admin/firestore";

import { ApiError } from "../../../utils/apiError.js";
import type {
  IntegrationConnection,
  IntegrationConnectionStatus,
  IntegrationConnectResult,
  IntegrationExchangeResult,
  IntegrationProvider,
  IntegrationTokenPayload,
} from "../../core/integrationContracts.js";
import { IntegrationTokenStore } from "../../tokenStore/integrationTokenStore.js";

export const STRIPE_CAPABILITIES = ["payments.read", "payments.write"];

function apiKeyConnectError(): ApiError {
  return new ApiError({
    code: "API_KEY_CONNECT_REQUIRED",
    message: "Stripe connects with a restricted API key. Use POST /integrations/stripe/connect-key.",
    status: 400,
  });
}

/**
 * Stripe integration provider. Unlike Gmail/HubSpot it does NOT use OAuth —
 * workspaces connect by providing a (restricted) API key, stored encrypted via
 * the shared token store as tokenPayload.raw.apiKey.
 */
export class StripeProvider implements IntegrationProvider {
  readonly id = "stripe" as const;
  readonly displayName = "Stripe";
  readonly defaultCapabilities = STRIPE_CAPABILITIES;

  private readonly tokenStore: IntegrationTokenStore;

  constructor(private readonly db: Firestore) {
    this.tokenStore = new IntegrationTokenStore(db);
  }

  getRequiredScopes(): string[] {
    return [];
  }

  async getConnectUrl(): Promise<IntegrationConnectResult> {
    throw apiKeyConnectError();
  }

  async exchangeCode(): Promise<IntegrationExchangeResult> {
    throw apiKeyConnectError();
  }

  async refreshAccessTokenIfNeeded(connection: IntegrationConnection): Promise<IntegrationTokenPayload> {
    // API keys do not expire/refresh — return the stored payload as-is.
    const payload = await this.tokenStore.read(connection);
    if (!payload) {
      throw new ApiError({
        code: "INTEGRATION_TOKEN_MISSING",
        message: "Stripe API key is missing. Reconnect Stripe.",
        status: 409,
      });
    }
    return payload;
  }

  async getConnectionStatus(connection: IntegrationConnection): Promise<IntegrationConnectionStatus> {
    try {
      const apiKey = await readStripeApiKey(this.db, connection.workspaceId);
      await new Stripe(apiKey).balance.retrieve();
      return { status: "connected" };
    } catch {
      return {
        status: "error",
        reconnectReason: "Stripe API key is invalid or revoked. Reconnect with a new restricted key.",
        lastErrorCode: "STRIPE_KEY_INVALID",
      };
    }
  }

  async disconnect(): Promise<void> {
    // Nothing to revoke server-side for API keys; the integration service clears the doc/token.
  }
}

/** Validate a candidate Stripe secret/restricted key by making a live read call. */
export async function validateStripeApiKey(apiKey: string): Promise<void> {
  if (!/^(sk|rk)_(test|live)_/.test(apiKey)) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      message: "That doesn't look like a Stripe secret/restricted key (sk_… or rk_…). Restricted test-mode keys are recommended.",
      status: 400,
    });
  }
  try {
    await new Stripe(apiKey).balance.retrieve();
  } catch (error) {
    throw new ApiError({
      code: "STRIPE_KEY_INVALID",
      message: "Stripe rejected this API key. Check the key (and that it has read access to Balance).",
      status: 400,
      details: { error: error instanceof Error ? error.message : String(error) },
    });
  }
}

/** Read the workspace's stored Stripe API key (throws a clear error when absent). */
export async function readStripeApiKey(db: Firestore, workspaceId: string): Promise<string> {
  const payload = await new IntegrationTokenStore(db).read({ workspaceId, provider: "stripe" });
  const apiKey = payload?.raw?.["apiKey"];
  if (typeof apiKey !== "string" || !apiKey) {
    throw new ApiError({
      code: "INTEGRATION_TOKEN_MISSING",
      message: "Stripe is not connected for this workspace. Connect it with an API key first.",
      status: 409,
    });
  }
  return apiKey;
}
