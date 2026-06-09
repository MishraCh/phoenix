import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { env } from "../config/env.js";
import { createIntegrationOAuthState } from "../integrations/core/oauthState.js";
import { IntegrationService } from "../integrations/integrationService.js";
import { HubSpotProvider } from "../integrations/providers/hubspot/hubspotProvider.js";
import { IntegrationTokenStore } from "../integrations/tokenStore/integrationTokenStore.js";
import { integrationSchema, type Integration } from "../schemas/coreSchemas.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

function asDb(fake: FakeFirestore) {
  return fake as unknown as Firestore;
}

function seedHubSpotConnection(fake: FakeFirestore, overrides: Record<string, unknown> = {}): Integration {
  const now = Timestamp.now();
  const integration = integrationSchema.parse({
    id: "hubspot",
    workspaceId: "ws_test",
    provider: "hubspot",
    status: "connected",
    scopes: [],
    scopesGranted: [],
    tokenRef: "workspaces/ws_test/integrations/hubspot",
    capabilities: ["crm.read", "crm.write"],
    syncError: null,
    connectedBy: "user_123",
    ownedByUserId: "user_123",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
  fake.seed("workspaces/ws_test/integrations/hubspot", integration);
  return integration;
}

describe("HubSpot integration service and provider hardening", () => {
  const originalStateSecret = env.INTEGRATION_STATE_SECRET;
  const originalFrontendOrigin = env.FRONTEND_ORIGIN;
  const originalPostAuthRedirect = env.HUBSPOT_POST_AUTH_REDIRECT;
  const originalClientId = env.HUBSPOT_CLIENT_ID;
  const originalClientSecret = env.HUBSPOT_CLIENT_SECRET;
  const originalRedirectUri = env.HUBSPOT_REDIRECT_URI;
  const originalEncryptionKey = env.INTEGRATION_ENCRYPTION_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    env.INTEGRATION_STATE_SECRET = "integration-test-secret";
    env.FRONTEND_ORIGIN = "https://gideon.test";
    env.HUBSPOT_POST_AUTH_REDIRECT = "https://gideon.test/integrations/hubspot";
    env.HUBSPOT_CLIENT_ID = "hubspot-client-id";
    env.HUBSPOT_CLIENT_SECRET = "hubspot-client-secret";
    env.HUBSPOT_REDIRECT_URI = "https://gideon.test/api/integrations/hubspot/callback";
    env.INTEGRATION_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  });

  afterAll(() => {
    env.INTEGRATION_STATE_SECRET = originalStateSecret;
    env.FRONTEND_ORIGIN = originalFrontendOrigin;
    env.HUBSPOT_POST_AUTH_REDIRECT = originalPostAuthRedirect;
    env.HUBSPOT_CLIENT_ID = originalClientId;
    env.HUBSPOT_CLIENT_SECRET = originalClientSecret;
    env.HUBSPOT_REDIRECT_URI = originalRedirectUri;
    env.INTEGRATION_ENCRYPTION_KEY = originalEncryptionKey;
  });

  it("stores encrypted HubSpot credentials and safe metadata after OAuth callback success", async () => {
    const fake = new FakeFirestore();
    const service = new IntegrationService(asDb(fake));
    const state = createIntegrationOAuthState({
      workspaceId: "ws_test",
      userId: "user_123",
      provider: "hubspot",
      createdAt: Date.now(),
    });
    const expiresAt = Timestamp.fromMillis(Date.now() + 60 * 60 * 1000);
    vi.spyOn(HubSpotProvider.prototype, "exchangeCode").mockResolvedValue({
      status: "connected",
      scopes: ["crm.objects.contacts.read", "crm.objects.deals.write"],
      capabilities: ["crm.read", "crm.write"],
      tokenPayload: {
        accessToken: "hubspot-access-token",
        refreshToken: "hubspot-refresh-token",
        expiryDate: expiresAt.toMillis(),
      },
      tokenExpiresAt: expiresAt,
    });

    const redirectUrl = await service.handleOAuthCallback("hubspot", {
      code: "oauth-code",
      state,
    });

    expect(redirectUrl).toContain("status=connected");
    expect(redirectUrl).not.toContain("hubspot-access-token");
    const stored = fake.read("workspaces/ws_test/integrations/hubspot");
    expect(stored?.["connectedBy"]).toBe("user_123");
    expect(stored?.["ownedByUserId"]).toBe("user_123");
    expect(typeof stored?.["encryptedToken"]).toBe("string");
    expect(String(stored?.["encryptedToken"])).not.toContain("hubspot-access-token");
    expect(String(stored?.["encryptedToken"])).not.toContain("hubspot-refresh-token");
  });

  it("redirects safely when HubSpot OAuth callback returns an error", async () => {
    const redirectUrl = await new IntegrationService(asDb(new FakeFirestore())).handleOAuthCallback("hubspot", {
      error: "access_denied",
    });

    expect(redirectUrl).toContain("status=error");
    expect(redirectUrl).toContain("access_denied");
    expect(redirectUrl).not.toContain("access_token");
  });

  it("refreshes HubSpot tokens and updates stored token metadata", async () => {
    const fake = new FakeFirestore();
    const connection = seedHubSpotConnection(fake);
    const tokenStore = new IntegrationTokenStore(asDb(fake));
    await tokenStore.write(connection, {
      accessToken: "expired-access",
      refreshToken: "refresh-token",
      expiryDate: Date.now() - 10_000,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
        expires_in: 3600,
        token_type: "bearer",
      }),
    }));

    const refreshed = await new HubSpotProvider(asDb(fake)).refreshAccessTokenIfNeeded(connection);
    const stored = await tokenStore.read(connection);

    expect(refreshed.accessToken).toBe("fresh-access");
    expect(stored?.accessToken).toBe("fresh-access");
    expect(stored?.refreshToken).toBe("fresh-refresh");
    const storedDoc = fake.read("workspaces/ws_test/integrations/hubspot");
    expect(storedDoc?.["lastSuccessfulRefreshAt"]).toBeInstanceOf(Timestamp);
  });

  it("records HubSpot refresh failures safely and resolves the connection to reconnect_needed", async () => {
    const fake = new FakeFirestore();
    const connection = seedHubSpotConnection(fake, {
      refreshFailureAt: undefined,
      lastErrorCode: undefined,
    });
    const tokenStore = new IntegrationTokenStore(asDb(fake));
    await tokenStore.write(connection, {
      accessToken: "expired-access",
      refreshToken: "refresh-token",
      expiryDate: Date.now() - 10_000,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    }));

    await expect(new HubSpotProvider(asDb(fake)).refreshAccessTokenIfNeeded(connection)).rejects.toThrow(
      /HubSpot token refresh failed/i,
    );

    const storedDoc = fake.read("workspaces/ws_test/integrations/hubspot");
    expect(storedDoc?.["lastErrorCode"]).toBe("hubspot_refresh_failed");
    expect(storedDoc?.["refreshFailureAt"]).toBeInstanceOf(Timestamp);
    expect(JSON.stringify(storedDoc)).not.toContain("expired-access");
    expect(JSON.stringify(storedDoc)).not.toContain("refresh-token");

    const updatedConnection = integrationSchema.parse({ id: "hubspot", ...storedDoc });
    const status = await new HubSpotProvider(asDb(fake)).getConnectionStatus(updatedConnection);
    expect(status.status).toBe("reconnect_needed");
  });

  it("normalizes HubSpot search results for contacts, companies, and deals", async () => {
    const fake = new FakeFirestore();
    const connection = seedHubSpotConnection(fake);
    const tokenStore = new IntegrationTokenStore(asDb(fake));
    await tokenStore.write(connection, {
      accessToken: "live-access",
      refreshToken: "refresh-token",
      expiryDate: Date.now() + 60 * 60 * 1000,
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: "contact_1",
              properties: {
                firstname: "Alex",
                lastname: "Founder",
                email: "alex@example.com",
              },
              updatedAt: "2026-05-18T10:00:00.000Z",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: "company_1",
              properties: {
                name: "Acme",
                domain: "acme.com",
                industry: "SaaS",
              },
              updatedAt: "2026-05-18T10:00:00.000Z",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: "deal_1",
              properties: {
                dealname: "Acme Renewal",
                dealstage: "contractsent",
                amount: "25000",
              },
              updatedAt: "2026-05-18T10:00:00.000Z",
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new HubSpotProvider(asDb(fake));
    const contacts = await provider.searchRecords(connection, { objectType: "contacts", query: "alex" });
    const companies = await provider.searchRecords(connection, { objectType: "companies", query: "acme" });
    const deals = await provider.searchRecords(connection, { objectType: "deals", query: "renewal" });

    expect(contacts[0]).toMatchObject({ id: "contact_1", title: "Alex Founder", subtitle: "alex@example.com" });
    expect(companies[0]).toMatchObject({ id: "company_1", title: "Acme", subtitle: "SaaS" });
    expect(deals[0]).toMatchObject({ id: "deal_1", title: "Acme Renewal", subtitle: "contractsent • 25000" });
  });

  it("returns HubSpot record detail and supports bounded updates", async () => {
    const fake = new FakeFirestore();
    const connection = seedHubSpotConnection(fake);
    const tokenStore = new IntegrationTokenStore(asDb(fake));
    await tokenStore.write(connection, {
      accessToken: "live-access",
      refreshToken: "refresh-token",
      expiryDate: Date.now() + 60 * 60 * 1000,
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "deal_1",
          properties: {
            dealname: "Acme Renewal",
            dealstage: "contractsent",
          },
          updatedAt: "2026-05-18T10:00:00.000Z",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "deal_1",
          properties: {
            dealname: "Acme Renewal",
            dealstage: "closedwon",
          },
          updatedAt: "2026-05-18T10:05:00.000Z",
          archived: false,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new HubSpotProvider(asDb(fake));
    const detail = await provider.getRecord(connection, { objectType: "deals", recordId: "deal_1" });
    const updated = await provider.updateRecord(connection, {
      objectType: "deals",
      recordId: "deal_1",
      updates: { dealstage: "closedwon" },
    });

    expect(detail.id).toBe("deal_1");
    expect(updated.properties?.["dealstage"]).toBe("closedwon");
  });
});
