import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { google } from "googleapis";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { env } from "../config/env.js";
import { createIntegrationOAuthState } from "../integrations/core/oauthState.js";
import { IntegrationService } from "../integrations/integrationService.js";
import { GmailProvider } from "../integrations/providers/gmail/gmailProvider.js";
import { GmailSyncService } from "../integrations/providers/gmail/gmailSyncService.js";
import { IntegrationTokenStore } from "../integrations/tokenStore/integrationTokenStore.js";
import { integrationSchema, type Integration } from "../schemas/coreSchemas.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

function asDb(fake: FakeFirestore) {
  return fake as unknown as Firestore;
}

function seedGmailConnection(fake: FakeFirestore, overrides: Record<string, unknown> = {}): Integration {
  const now = Timestamp.now();
  const integration = integrationSchema.parse({
    id: "gmail",
    workspaceId: "ws_test",
    provider: "gmail",
    status: "connected",
    scopes: [],
    scopesGranted: [],
    tokenRef: "workspaces/ws_test/integrations/gmail",
    capabilities: ["email.read", "email.draft", "email.send"],
    syncError: null,
    connectedBy: "user_123",
    ownedByUserId: "user_123",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
  fake.seed("workspaces/ws_test/integrations/gmail", integration);
  return integration;
}

describe("Gmail integration service and token hardening", () => {
  const originalStateSecret = env.INTEGRATION_STATE_SECRET;
  const originalFrontendOrigin = env.FRONTEND_ORIGIN;
  const originalPostAuthRedirect = env.GMAIL_POST_AUTH_REDIRECT;
  const originalClientId = env.GOOGLE_CLIENT_ID;
  const originalClientSecret = env.GOOGLE_CLIENT_SECRET;
  const originalRedirectUri = env.GOOGLE_REDIRECT_URI;
  const originalEncryptionKey = env.INTEGRATION_ENCRYPTION_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
    env.INTEGRATION_STATE_SECRET = "integration-test-secret";
    env.FRONTEND_ORIGIN = "https://gideon.test";
    env.GMAIL_POST_AUTH_REDIRECT = "https://gideon.test/integrations/gmail";
    env.GOOGLE_CLIENT_ID = "google-client-id";
    env.GOOGLE_CLIENT_SECRET = "google-client-secret";
    env.GOOGLE_REDIRECT_URI = "https://gideon.test/api/integrations/gmail/callback";
    env.INTEGRATION_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  });

  afterAll(() => {
    env.INTEGRATION_STATE_SECRET = originalStateSecret;
    env.FRONTEND_ORIGIN = originalFrontendOrigin;
    env.GMAIL_POST_AUTH_REDIRECT = originalPostAuthRedirect;
    env.GOOGLE_CLIENT_ID = originalClientId;
    env.GOOGLE_CLIENT_SECRET = originalClientSecret;
    env.GOOGLE_REDIRECT_URI = originalRedirectUri;
    env.INTEGRATION_ENCRYPTION_KEY = originalEncryptionKey;
  });

  it("stores encrypted Gmail credentials and safe metadata after OAuth callback success", async () => {
    const fake = new FakeFirestore();
    const service = new IntegrationService(asDb(fake));
    const state = createIntegrationOAuthState({
      workspaceId: "ws_test",
      userId: "user_123",
      provider: "gmail",
      createdAt: Date.now(),
    });
    const expiresAt = Timestamp.fromMillis(Date.now() + 60 * 60 * 1000);
    vi.spyOn(GmailProvider.prototype, "exchangeCode").mockResolvedValue({
      status: "connected",
      scopes: ["gmail.readonly", "gmail.compose", "gmail.send"],
      capabilities: ["email.read", "email.draft", "email.send"],
      tokenPayload: {
        accessToken: "access_token_value",
        refreshToken: "refresh_token_value",
        expiryDate: expiresAt.toMillis(),
      },
      tokenExpiresAt: expiresAt,
    });
    vi.spyOn(GmailSyncService.prototype, "initializeConnectionMetadata").mockResolvedValue(undefined);

    const redirectUrl = await service.handleOAuthCallback("gmail", {
      code: "oauth-code",
      state,
    });

    expect(redirectUrl).toContain("status=connected");
    expect(redirectUrl).not.toContain("access_token_value");
    expect(redirectUrl).not.toContain("refresh_token_value");
    const stored = fake.read("workspaces/ws_test/integrations/gmail");
    expect(stored?.["connectedBy"]).toBe("user_123");
    expect(stored?.["ownedByUserId"]).toBe("user_123");
    expect(stored?.["watchStatus"]).toBe("pending");
    expect(stored?.["retentionDays"]).toBe(30);
    expect(typeof stored?.["encryptedToken"]).toBe("string");
    expect(String(stored?.["encryptedToken"])).not.toContain("access_token_value");
  });

  it("redirects safely when Gmail OAuth callback returns an error", async () => {
    const redirectUrl = await new IntegrationService(asDb(new FakeFirestore())).handleOAuthCallback("gmail", {
      error: "access_denied",
    });

    expect(redirectUrl).toContain("status=error");
    expect(redirectUrl).toContain("access_denied");
    expect(redirectUrl).not.toContain("access_token");
  });

  it("refreshes Gmail tokens and updates stored token metadata", async () => {
    const fake = new FakeFirestore();
    const connection = seedGmailConnection(fake);
    const tokenStore = new IntegrationTokenStore(asDb(fake));
    await tokenStore.write(connection, {
      accessToken: "expired-access",
      refreshToken: "refresh-token",
      expiryDate: Date.now() - 10_000,
    });
    vi.spyOn(google.auth.OAuth2.prototype, "refreshAccessToken").mockResolvedValue({
      credentials: {
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
        expiry_date: Date.now() + 60 * 60 * 1000,
      },
    } as never);

    const refreshed = await new GmailProvider(asDb(fake)).refreshAccessTokenIfNeeded(connection);
    const stored = await tokenStore.read(connection);

    expect(refreshed.accessToken).toBe("fresh-access");
    expect(stored?.accessToken).toBe("fresh-access");
    expect(stored?.refreshToken).toBe("fresh-refresh");
    const storedDoc = fake.read("workspaces/ws_test/integrations/gmail");
    expect(storedDoc?.["lastSuccessfulRefreshAt"]).toBeInstanceOf(Timestamp);
  });

  it("records refresh failures safely and resolves expired Gmail connections to reconnect_needed", async () => {
    const fake = new FakeFirestore();
    const connection = seedGmailConnection(fake);
    const tokenStore = new IntegrationTokenStore(asDb(fake));
    await tokenStore.write(connection, {
      accessToken: "expired-access",
      refreshToken: "refresh-token",
      expiryDate: Date.now() - 10_000,
    });
    vi.spyOn(google.auth.OAuth2.prototype, "refreshAccessToken").mockRejectedValue(new Error("refresh denied"));

    await expect(new GmailProvider(asDb(fake)).refreshAccessTokenIfNeeded(connection)).rejects.toThrow("refresh denied");

    const storedDoc = fake.read("workspaces/ws_test/integrations/gmail");
    expect(storedDoc?.["lastErrorCode"]).toBe("gmail_refresh_failed");
    expect(storedDoc?.["refreshFailureAt"]).toBeInstanceOf(Timestamp);
    expect(JSON.stringify(storedDoc)).not.toContain("expired-access");
    expect(JSON.stringify(storedDoc)).not.toContain("refresh-token");

    const updatedConnection = integrationSchema.parse({ id: "gmail", ...storedDoc });
    const status = await new GmailProvider(asDb(fake)).getConnectionStatus(updatedConnection);
    expect(status.status).toBe("reconnect_needed");
  });

  it("marks Gmail as reconnect_needed when no refresh token is available for an expired token", async () => {
    const fake = new FakeFirestore();
    const connection = seedGmailConnection(fake);
    const tokenStore = new IntegrationTokenStore(asDb(fake));
    await tokenStore.write(connection, {
      accessToken: "expired-access",
      expiryDate: Date.now() - 5_000,
    });

    const status = await new GmailProvider(asDb(fake)).getConnectionStatus(connection);

    expect(status.status).toBe("reconnect_needed");
    expect(status.reconnectReason).toMatch(/Refresh token is missing/i);
  });
});
