import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { env } from "../../../config/env.js";
import { ApiError } from "../../../utils/apiError.js";
import { createIntegrationOAuthState, parseIntegrationOAuthState } from "../../core/oauthState.js";
import type {
  IntegrationConnection,
  IntegrationConnectionStatus,
  IntegrationConnectContext,
  IntegrationConnectResult,
  IntegrationExchangeResult,
  IntegrationProvider,
  IntegrationTokenPayload,
} from "../../core/integrationContracts.js";
import { IntegrationTokenStore } from "../../tokenStore/integrationTokenStore.js";

const hubspotScopes = [
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.companies.read",
  "crm.objects.companies.write",
  "crm.objects.deals.read",
  "crm.objects.deals.write",
  "crm.objects.owners.read",
  "crm.schemas.contacts.read",
  "crm.schemas.companies.read",
  "crm.schemas.deals.read",
];

const HUBSPOT_OAUTH_BASE = "https://app.hubspot.com/oauth/authorize";
const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const HUBSPOT_API_BASE = "https://api.hubapi.com";
const HUBSPOT_ACCESS_TOKEN_INFO_URL = "https://api.hubapi.com/oauth/v1/access-tokens";

export type HubSpotObjectType = "contacts" | "companies" | "deals" | "notes" | "tasks";

type HubSpotAssociationObjectType = HubSpotObjectType;

const HUBSPOT_PROPERTIES: Record<HubSpotObjectType, string[]> = {
  contacts: [
    "firstname",
    "lastname",
    "email",
    "phone",
    "jobtitle",
    "company",
    "lifecyclestage",
    "lastmodifieddate",
    "createdate",
    "hs_object_id",
    "hubspotscore",
  ],
  companies: [
    "name",
    "domain",
    "industry",
    "city",
    "state",
    "country",
    "lastmodifieddate",
    "createdate",
    "hs_object_id",
    "hubspotscore",
  ],
  deals: [
    "dealname",
    "dealstage",
    "amount",
    "pipeline",
    "closedate",
    "hs_lastmodifieddate",
    "createdate",
    "hubspot_owner_id",
    "hs_object_id",
  ],
  notes: [
    "hs_note_body",
    "hs_timestamp",
    "hs_lastmodifieddate",
    "hubspot_owner_id",
    "createdate",
    "hs_object_id",
  ],
  tasks: [
    "hs_task_subject",
    "hs_task_body",
    "hs_task_status",
    "hs_task_priority",
    "hs_timestamp",
    "hs_lastmodifieddate",
    "hubspot_owner_id",
    "createdate",
    "hs_object_id",
  ],
};

function requiredEnv(name: "HUBSPOT_CLIENT_ID" | "HUBSPOT_CLIENT_SECRET" | "HUBSPOT_REDIRECT_URI") {
  const value = env[name];

  if (!value) {
    throw new ApiError({
      code: "INTEGRATION_CONFIG_MISSING",
      message: `${name} is required for HubSpot OAuth.`,
      status: 500,
    });
  }

  return value;
}

function toFormUrlEncoded(payload: Record<string, string>) {
  return new URLSearchParams(payload).toString();
}

export type HubSpotRecordSummary = {
  id: string;
  title: string;
  subtitle: string;
  properties: Record<string, unknown>;
  updatedAt: string | null;
};

export type HubSpotRecordDetail = {
  id: string;
  properties?: Record<string, string | null | undefined>;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
};

export type HubSpotRelatedRecord = {
  id: string;
  module: HubSpotObjectType;
  title: string;
  subtitle: string;
  properties: Record<string, unknown>;
  updatedAt: string | null;
};

function joinName(firstName?: string | null, lastName?: string | null) {
  return `${firstName ?? ""} ${lastName ?? ""}`.trim();
}

function summarizeRecord(objectType: HubSpotObjectType, record: {
  id: string;
  properties?: Record<string, string | null | undefined>;
  updatedAt?: string;
  createdAt?: string;
}) {
  const props = record.properties ?? {};
  const title =
    objectType === "contacts"
      ? joinName(props["firstname"], props["lastname"]) || props["email"] || "Untitled contact"
      : objectType === "companies"
        ? props["name"] || props["domain"] || "Untitled company"
        : objectType === "deals"
          ? props["dealname"] || "Untitled deal"
          : objectType === "notes"
            ? (props["hs_note_body"] ?? "").slice(0, 64) || "Untitled note"
            : props["hs_task_subject"] || props["hs_task_body"] || "Untitled task";
  const subtitle =
    objectType === "contacts"
      ? [props["jobtitle"], props["company"], props["email"]].filter(Boolean).join(" • ") || ""
      : objectType === "companies"
        ? props["industry"] || props["domain"] || ""
        : objectType === "deals"
          ? [props["dealstage"], props["amount"]].filter(Boolean).join(" • ")
          : objectType === "notes"
            ? props["hs_timestamp"] || props["createdate"] || ""
            : [props["hs_task_status"], props["hs_task_priority"]].filter(Boolean).join(" • ");

  return {
    id: record.id,
    title,
    subtitle,
    properties: props,
    updatedAt:
      record.updatedAt ??
      props["lastmodifieddate"] ??
      props["hs_lastmodifieddate"] ??
      props["hs_timestamp"] ??
      record.createdAt ??
      null,
  } satisfies HubSpotRecordSummary;
}

export class HubSpotProvider implements IntegrationProvider {
  readonly id = "hubspot" as const;
  readonly displayName = "HubSpot";
  readonly defaultCapabilities = ["crm.read", "crm.write"];

  private readonly tokenStore: IntegrationTokenStore;

  constructor(private readonly db: Firestore) {
    this.tokenStore = new IntegrationTokenStore(db);
  }

  getRequiredScopes() {
    return [...hubspotScopes];
  }

  async getConnectUrl(context: IntegrationConnectContext): Promise<IntegrationConnectResult> {
    const state = createIntegrationOAuthState({
      workspaceId: context.workspaceId,
      userId: context.userId,
      provider: "hubspot",
      createdAt: Date.now(),
    });

    const authUrl = new URL(HUBSPOT_OAUTH_BASE);
    authUrl.searchParams.set("client_id", requiredEnv("HUBSPOT_CLIENT_ID"));
    authUrl.searchParams.set("redirect_uri", requiredEnv("HUBSPOT_REDIRECT_URI"));
    authUrl.searchParams.set("scope", hubspotScopes.join(" "));
    authUrl.searchParams.set("state", state);

    return { authUrl: authUrl.toString() };
  }

  async exchangeCode(input: { code: string; state: string }): Promise<IntegrationExchangeResult> {
    parseIntegrationOAuthState(input.state, "hubspot");

    const response = await fetch(HUBSPOT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: toFormUrlEncoded({
        grant_type: "authorization_code",
        client_id: requiredEnv("HUBSPOT_CLIENT_ID"),
        client_secret: requiredEnv("HUBSPOT_CLIENT_SECRET"),
        redirect_uri: requiredEnv("HUBSPOT_REDIRECT_URI"),
        code: input.code,
      }),
    });

    if (!response.ok) {
      throw new ApiError({
        code: "INTEGRATION_OAUTH_FAILED",
        message: `HubSpot OAuth exchange failed with status ${response.status}.`,
        status: 502,
      });
    }

    const tokens = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
    };
    const metadata = tokens.access_token
      ? await this.fetchAccountMetadata(tokens.access_token).catch(() => null)
      : null;

    const expiryDate =
      typeof tokens.expires_in === "number"
        ? Date.now() + tokens.expires_in * 1000
        : undefined;

    return {
      status: "connected",
      scopes: tokens.scope?.split(" ").filter(Boolean) ?? [...hubspotScopes],
      capabilities: [...this.defaultCapabilities],
      tokenPayload: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenType: tokens.token_type,
        scope: tokens.scope,
        expiryDate,
      },
      tokenExpiresAt: expiryDate ? Timestamp.fromMillis(expiryDate) : undefined,
      metadata: metadata
        ? {
            portalId: metadata.portalId,
            accountEmail: metadata.accountEmail,
          }
        : undefined,
    };
  }

  private async fetchAccountMetadata(accessToken: string) {
    const response = await fetch(`${HUBSPOT_ACCESS_TOKEN_INFO_URL}/${encodeURIComponent(accessToken)}`);
    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as {
      hub_id?: number;
      user?: string;
    };

    return {
      portalId: typeof payload.hub_id === "number" ? payload.hub_id : null,
      accountEmail: typeof payload.user === "string" && payload.user.includes("@") ? payload.user : null,
    };
  }

  private activeHubSpotRefreshes = new Map<string, Promise<IntegrationTokenPayload>>();

  async refreshAccessTokenIfNeeded(connection: IntegrationConnection): Promise<IntegrationTokenPayload> {
    const lockKey = `${connection.workspaceId}:${connection.id}`;
    if (this.activeHubSpotRefreshes.has(lockKey)) {
      return this.activeHubSpotRefreshes.get(lockKey)!;
    }

    const refreshPromise = this.doRefreshAccessTokenIfNeeded(connection).finally(() => {
      this.activeHubSpotRefreshes.delete(lockKey);
    });

    this.activeHubSpotRefreshes.set(lockKey, refreshPromise);
    return refreshPromise;
  }

  private async doRefreshAccessTokenIfNeeded(connection: IntegrationConnection): Promise<IntegrationTokenPayload> {
    const stored = await this.tokenStore.read(connection);

    if (!stored) {
      throw new ApiError({
        code: "INTEGRATION_TOKEN_MISSING",
        message: "HubSpot connection is missing stored credentials.",
        status: 409,
      });
    }

    if (stored.expiryDate && stored.expiryDate - Date.now() > 60_000 && stored.accessToken) {
      return stored;
    }

    if (!stored.refreshToken) {
      throw new ApiError({
        code: "INTEGRATION_RECONNECT_REQUIRED",
        message: "HubSpot needs to be reconnected because no refresh token is available.",
        status: 409,
      });
    }

    let retries = 3;
    let response: Response | null = null;

    while (retries > 0) {
      try {
        response = await fetch(HUBSPOT_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: toFormUrlEncoded({
            grant_type: "refresh_token",
            client_id: requiredEnv("HUBSPOT_CLIENT_ID"),
            client_secret: requiredEnv("HUBSPOT_CLIENT_SECRET"),
            redirect_uri: requiredEnv("HUBSPOT_REDIRECT_URI"),
            refresh_token: stored.refreshToken,
          }),
        });

        if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
          break; // Stop retrying on success or permanent client errors
        }
      } catch (err) {
        // Network errors will be caught here
      }

      retries--;
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1500)); // wait 1.5s before retry
      }
    }

    if (!response || !response.ok) {
      await this.tokenStore.markRefreshFailure(connection, "hubspot_refresh_failed");
      throw new ApiError({
        code: "INTEGRATION_REFRESH_FAILED",
        message: `HubSpot token refresh failed with status ${response?.status ?? "unknown"}.`,
        status: 502,
      });
    }

    const refreshedPayload = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
    };

    const refreshed: IntegrationTokenPayload = {
      accessToken: refreshedPayload.access_token ?? stored.accessToken,
      refreshToken: refreshedPayload.refresh_token ?? stored.refreshToken,
      tokenType: refreshedPayload.token_type ?? stored.tokenType,
      scope: refreshedPayload.scope ?? stored.scope,
      expiryDate:
        typeof refreshedPayload.expires_in === "number"
          ? Date.now() + refreshedPayload.expires_in * 1000
          : stored.expiryDate,
    };

    await this.tokenStore.write(connection, refreshed);
    return refreshed;
  }

  async getConnectionStatus(connection: IntegrationConnection): Promise<IntegrationConnectionStatus> {
    try {
      const token = await this.tokenStore.read(connection);

      if (!token) {
        return { status: "disconnected", reconnectReason: "No HubSpot token is stored." };
      }

      if (!token.refreshToken && (!token.accessToken || !token.expiryDate || token.expiryDate < Date.now())) {
        return {
          status: "reconnect_needed",
          reconnectReason: "Refresh token is missing for this HubSpot connection.",
          lastErrorCode: connection.lastErrorCode,
        };
      }

      if (connection.refreshFailureAt && (!token.expiryDate || token.expiryDate <= Date.now())) {
        return {
          status: "reconnect_needed",
          reconnectReason: "HubSpot needs to be reconnected because token refresh failed.",
          lastErrorCode: connection.lastErrorCode ?? "hubspot_refresh_failed",
        };
      }

      if (token.expiryDate && token.expiryDate <= Date.now()) {
        return { status: "expired", reconnectReason: "HubSpot access token expired." };
      }

      return { status: "connected" };
    } catch (error) {
      return {
        status: "error",
        reconnectReason: error instanceof Error ? error.message : "Unable to verify HubSpot status.",
        lastErrorCode: "hubspot_status_failed",
      };
    }
  }

  async disconnect(connection: IntegrationConnection) {
    await this.tokenStore.clear(connection);
  }

  private async authorizedFetch(
    connection: IntegrationConnection,
    path: string,
    init?: RequestInit,
  ) {
    const token = await this.refreshAccessTokenIfNeeded(connection);
    const response = await fetch(`${HUBSPOT_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        await this.tokenStore.markRefreshFailure(connection, "hubspot_access_denied");
        throw new ApiError({
          code: "INTEGRATION_RECONNECT_REQUIRED",
          message: "HubSpot needs to be reconnected before Gideon can continue.",
          status: 409,
        });
      }

      const responseText = await response.text().catch(() => "");
      const compactResponseText = responseText.replace(/\s+/g, " ").trim().slice(0, 240);

      throw new ApiError({
        code: "INTEGRATION_PROVIDER_FAILED",
        message: compactResponseText
          ? `HubSpot API request failed with status ${response.status}: ${compactResponseText}`
          : `HubSpot API request failed with status ${response.status}.`,
        status: 502,
      });
    }

    return response;
  }

  async searchRecords(
    connection: IntegrationConnection,
    input: { objectType: HubSpotObjectType; query?: string; limit?: number },
  ): Promise<HubSpotRecordSummary[]> {
    const objectType = input.objectType;
    const properties = HUBSPOT_PROPERTIES[objectType];
    const limit = Math.min(input.limit ?? 20, 50);
    const query = input.query?.trim();
    const response = query
      ? await this.authorizedFetch(connection, `/crm/v3/objects/${objectType}/search`, {
          method: "POST",
          body: JSON.stringify({
            limit,
            properties,
            query,
          }),
        })
      : await this.authorizedFetch(
          connection,
          `/crm/v3/objects/${objectType}?limit=${limit}&properties=${properties.join(",")}`,
        );

    const payload = await response.json() as {
      results?: Array<{
        id: string;
        properties?: Record<string, string | null | undefined>;
        updatedAt?: string;
        createdAt?: string;
      }>;
    };

    return (payload.results ?? []).map((record) => summarizeRecord(objectType, record));
  }

  async getRecord(
    connection: IntegrationConnection,
    input: { objectType: HubSpotObjectType; recordId: string },
  ) {
    const properties = HUBSPOT_PROPERTIES[input.objectType];
    const response = await this.authorizedFetch(
      connection,
      `/crm/v3/objects/${input.objectType}/${input.recordId}?properties=${properties.join(",")}`,
    );

    return await response.json() as HubSpotRecordDetail;
  }

  async getAssociations(
    connection: IntegrationConnection,
    input: {
      fromObjectType: HubSpotAssociationObjectType;
      fromRecordId: string;
      toObjectType: HubSpotAssociationObjectType;
      limit?: number;
    },
  ) {
    const response = await this.authorizedFetch(
      connection,
      `/crm/v4/objects/${input.fromObjectType}/${input.fromRecordId}/associations/${input.toObjectType}?limit=${Math.min(
        input.limit ?? 10,
        20,
      )}`,
    );

    const payload = await response.json() as {
      results?: Array<{ toObjectId: string | number }>;
    };

    return (payload.results ?? [])
      .map((item) => String(item.toObjectId))
      .filter(Boolean);
  }

  async getRelatedRecords(
    connection: IntegrationConnection,
    input: {
      fromObjectType: HubSpotAssociationObjectType;
      fromRecordId: string;
      toObjectType: HubSpotAssociationObjectType;
      limit?: number;
    },
  ): Promise<HubSpotRelatedRecord[]> {
    const ids = await this.getAssociations(connection, input);
    if (!ids.length) {
      return [];
    }

    const records = await Promise.all(
      ids.slice(0, Math.min(input.limit ?? 5, 8)).map(async (recordId) => {
        const detail = await this.getRecord(connection, {
          objectType: input.toObjectType,
          recordId,
        });

        return {
          module: input.toObjectType,
          ...summarizeRecord(input.toObjectType, {
            id: detail.id,
            properties: detail.properties,
            createdAt: detail.createdAt,
            updatedAt: detail.updatedAt,
          }),
        };
      }),
    );

    return records;
  }

  async updateRecord(
    connection: IntegrationConnection,
    input: {
      objectType: HubSpotObjectType;
      recordId: string;
      updates: Record<string, unknown>;
    },
  ) {
    if (!Object.keys(input.updates).length) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: "HubSpot update payload must include at least one field.",
        status: 400,
      });
    }

    const response = await this.authorizedFetch(
      connection,
      `/crm/v3/objects/${input.objectType}/${input.recordId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          properties: input.updates,
        }),
      },
    );

    return await response.json() as {
      id: string;
      properties?: Record<string, string | null | undefined>;
      createdAt?: string;
      updatedAt?: string;
      archived?: boolean;
    };
  }

  async createRecord(
    connection: IntegrationConnection,
    input: {
      objectType: HubSpotObjectType;
      properties: Record<string, unknown>;
      associations?: Array<{
        to: { id: string };
        types: Array<Record<string, unknown>>;
      }>;
    },
  ) {
    if (!Object.keys(input.properties).length) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: "HubSpot create payload must include at least one property.",
        status: 400,
      });
    }

    const response = await this.authorizedFetch(
      connection,
      `/crm/v3/objects/${input.objectType}`,
      {
        method: "POST",
        body: JSON.stringify({
          properties: input.properties,
          associations: input.associations,
        }),
      },
    );

    return await response.json() as {
      id: string;
      properties?: Record<string, string | null | undefined>;
      createdAt?: string;
      updatedAt?: string;
      archived?: boolean;
    };
  }

  async createAssociatedNote(
    connection: IntegrationConnection,
    input: {
      recordType: "contacts" | "companies" | "deals";
      recordId: string;
      body: string;
      timestamp?: string;
    },
  ) {
    const createdNote = await this.createRecord(connection, {
      objectType: "notes",
      properties: {
        hs_note_body: input.body,
        hs_timestamp: input.timestamp ?? new Date().toISOString(),
      },
    });
    await this.authorizedFetch(
      connection,
      `/crm/v4/objects/notes/${createdNote.id}/associations/default/${input.recordType}/${input.recordId}`,
      { method: "PUT" },
    );
    return createdNote;
  }

  async createAssociatedTask(
    connection: IntegrationConnection,
    input: {
      recordType: "contacts" | "companies" | "deals";
      recordId: string;
      subject: string;
      body?: string;
      dueAt?: string;
      status?: string;
      priority?: string;
    },
  ) {
    const createdTask = await this.createRecord(connection, {
      objectType: "tasks",
      properties: {
        hs_task_subject: input.subject,
        hs_task_body: input.body ?? "",
        hs_task_status: input.status ?? "NOT_STARTED",
        hs_task_priority: input.priority ?? "MEDIUM",
        hs_timestamp: input.dueAt ?? new Date().toISOString(),
      },
    });
    await this.authorizedFetch(
      connection,
      `/crm/v4/objects/tasks/${createdTask.id}/associations/default/${input.recordType}/${input.recordId}`,
      { method: "PUT" },
    );
    return createdTask;
  }

  async updateTask(
    connection: IntegrationConnection,
    input: {
      recordId: string;
      updates: Record<string, unknown>;
    },
  ) {
    return this.updateRecord(connection, {
      objectType: "tasks",
      recordId: input.recordId,
      updates: input.updates,
    });
  }

  async updateAssociation(
    connection: IntegrationConnection,
    input: {
      fromObjectType: "contacts" | "companies" | "deals";
      fromRecordId: string;
      toObjectType: "contacts" | "companies" | "deals" | "notes" | "tasks";
      toRecordId: string;
      action: "add" | "remove";
    },
  ) {
    const method = input.action === "add" ? "PUT" : "DELETE";
    await this.authorizedFetch(
      connection,
      `/crm/v4/objects/${input.fromObjectType}/${input.fromRecordId}/associations/default/${input.toObjectType}/${input.toRecordId}`,
      {
        method,
      },
    );

    return {
      action: input.action,
      fromObjectType: input.fromObjectType,
      fromRecordId: input.fromRecordId,
      toObjectType: input.toObjectType,
      toRecordId: input.toRecordId,
    };
  }
}
