import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

import { ActivityService } from "../activity/activityService.js";
import {
  invalidateCachedCapabilities,
  invalidateCachedIntegrationsCount,
} from "../cache/requestStateCache.js";
import { env } from "../config/env.js";
import { JobLockService } from "../jobs/jobLockService.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import {
  integrationSchema,
  type Integration,
  type IntegrationProviderId,
} from "../schemas/coreSchemas.js";
import { ApiError } from "../utils/apiError.js";
import { UsageService } from "../usage/usageService.js";
import { IntegrationItemRepository } from "../repositories/integrationItemRepository.js";
import { EmbeddingService } from "../ai/embeddings/embeddingService.js";
import { IndexingLifecycleService } from "../ai/indexing/indexingLifecycleService.js";
import { parseIntegrationOAuthState } from "./core/oauthState.js";
import type { IntegrationConnection } from "./core/integrationContracts.js";
import { encryptJson } from "./integrationCrypto.js";
import { GmailSyncService } from "./providers/gmail/gmailSyncService.js";
import { createIntegrationProvider, normalizeIntegrationProviderId } from "./providers/providerRegistry.js";
import { IntegrationCacheCoherenceService } from "./integrationCacheCoherenceService.js";

export type PublicIntegration = {
  id: string;
  provider: IntegrationProviderId;
  status: Integration["status"];
  capabilities: string[];
  scopes: string[];
  scopesGranted: string[];
  lastSyncedAt: string | null;
  syncError: string | null;
  ownedByUserId: string | null;
  connectedBy: string;
  reconnectReason: string | null;
  lastErrorCode: string | null;
  accountEmail: string | null;
  watchStatus: "pending" | "active" | "expired" | "error" | null;
  watchExpiration: string | null;
  lastDeltaSyncedAt: string | null;
  fullResyncRequired: boolean;
  access?: "owner" | "restricted";
  ownerOnly?: boolean;
};

export class IntegrationService {
  private readonly activityService: ActivityService;
  private readonly jobLockService: JobLockService;
  private readonly itemRepository: IntegrationItemRepository;

  constructor(private readonly db: Firestore) {
    this.activityService = new ActivityService(db);
    this.jobLockService = new JobLockService(db);
    this.itemRepository = new IntegrationItemRepository(db);
  }

  private collection(workspaceId: string) {
    return this.db.collection("workspaces").doc(workspaceId).collection("integrations");
  }

  private async serializeIntegration(integration: Integration): Promise<PublicIntegration> {
    let providerStatus: { status: Integration["status"]; reconnectReason?: string; lastErrorCode?: string };

    try {
      const provider = createIntegrationProvider(this.db, integration.provider);
      providerStatus = await provider.getConnectionStatus(integration as IntegrationConnection);
    } catch {
      providerStatus = {
        status: integration.status,
        reconnectReason: integration.reconnectReason,
        lastErrorCode: integration.lastErrorCode,
      };
    }
    const scopesGranted = integration.scopesGranted ?? integration.scopes ?? [];
    let resolvedStatus = providerStatus.status;

    if (integration.status === "syncing") {
      resolvedStatus = "syncing";
    } else if (integration.status === "error" && providerStatus.status === "connected") {
      resolvedStatus = "error";
    }

    return {
      id: integration.id,
      provider: normalizeIntegrationProviderId(integration.provider),
      status: resolvedStatus,
      capabilities: integration.capabilities,
      scopes: scopesGranted,
      scopesGranted,
      lastSyncedAt: integration.lastSyncedAt?.toDate().toISOString() ?? null,
      syncError: integration.syncError ?? null,
      ownedByUserId: integration.ownedByUserId ?? null,
      connectedBy: integration.connectedBy,
      reconnectReason: providerStatus.reconnectReason ?? integration.reconnectReason ?? null,
      lastErrorCode: providerStatus.lastErrorCode ?? integration.lastErrorCode ?? null,
      accountEmail: integration.accountEmail ?? null,
      watchStatus: integration.watchStatus ?? null,
      watchExpiration: integration.watchExpiration?.toDate().toISOString() ?? null,
      lastDeltaSyncedAt: integration.lastDeltaSyncedAt?.toDate().toISOString() ?? null,
      fullResyncRequired: integration.fullResyncRequired ?? false,
    };
  }

  private async findDocByProvider(workspaceId: string, provider: string) {
    const normalized = normalizeIntegrationProviderId(provider);
    const candidates = normalized === "gmail" ? ["gmail", "google"] : [normalized];

    for (const candidate of candidates) {
      const snapshot = await this.collection(workspaceId).doc(candidate).get();
      if (snapshot.exists) {
        return snapshot;
      }
    }

    return null;
  }

  private getMailboxOwnerId(integration: Pick<Integration, "ownedByUserId" | "connectedBy">) {
    return integration.ownedByUserId ?? integration.connectedBy;
  }

  private canAccessGmailContent(userId: string | undefined, integration: Integration) {
    if (integration.provider !== "gmail" && integration.provider !== "google") {
      return true;
    }

    if (!userId) {
      return false;
    }

    return this.getMailboxOwnerId(integration) === userId;
  }

  private assertGmailOwner(userId: string, integration: IntegrationConnection, action: string) {
    if (this.canAccessGmailContent(userId, integration)) {
      return;
    }

    throw new ApiError({
      code: "FORBIDDEN",
      message: `Only the user who connected this Gmail account can ${action}.`,
      status: 403,
    });
  }

  async listIntegrations(currentWorkspace: CurrentWorkspace) {
    const snapshot = await this.collection(currentWorkspace.id).get();
    const parsed = snapshot.docs
      .map((doc) => integrationSchema.parse({ id: doc.id, ...doc.data() }))
      .sort((left, right) => left.provider.localeCompare(right.provider));

    return await Promise.all(parsed.map((integration) => this.serializeIntegration(integration)));
  }

  async getIntegration(currentWorkspace: CurrentWorkspace, provider: string) {
    const snapshot = await this.findDocByProvider(currentWorkspace.id, provider);

    if (!snapshot?.exists) {
      return null;
    }

    return integrationSchema.parse({ id: snapshot.id, ...snapshot.data() });
  }

  async requireConnection(currentWorkspace: CurrentWorkspace, provider: string) {
    const integration = await this.getIntegration(currentWorkspace, provider);

    if (!integration) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: `Integration "${provider}" is not connected in this workspace.`,
        status: 404,
      });
    }

    return integration as IntegrationConnection;
  }

  async getIntegrationDetail(currentWorkspace: CurrentWorkspace, provider: string, userId?: string) {
    const integration = await this.requireConnection(currentWorkspace, provider);
    const canAccessContent = this.canAccessGmailContent(userId, integration);
    const recentItems = canAccessContent
      ? await this.itemRepository.listRecentByIntegration(currentWorkspace.id, integration.id)
      : [];

    return {
      ...(await this.serializeIntegration(integration)),
      access:
        integration.provider === "gmail" || integration.provider === "google"
          ? (canAccessContent ? "owner" : "restricted")
          : undefined,
      ownerOnly: integration.provider === "gmail" || integration.provider === "google" ? true : undefined,
      items: recentItems.map((item) => ({
        id: item.externalId,
        sourceType: item.sourceType,
        title: item.title ?? null,
        summary: item.summary ?? null,
        lastSyncedAt: item.lastSyncedAt.toDate().toISOString(),
        sourceHash: item.sourceHash,
      })),
    };
  }

  async createConnectUrl(currentWorkspace: CurrentWorkspace, userId: string, providerId: string) {
    const provider = createIntegrationProvider(this.db, providerId);

    // Gmail is temporarily gated: existing connections keep working, new connects are blocked.
    if (provider.id === "gmail") {
      throw new ApiError({
        code: "FEATURE_COMING_SOON",
        message: "Gmail is coming soon. Connect HubSpot or Stripe in the meantime.",
        status: 503,
      });
    }

    const existingIntegration = await this.getIntegration(currentWorkspace, provider.id);

    await new UsageService(this.db).assertIntegrationLimit(
      currentWorkspace.workspace,
      existingIntegration?.provider ?? null,
    );

    return provider.getConnectUrl({
      workspaceId: currentWorkspace.id,
      userId,
    });
  }

  /** Connect Stripe with a (restricted) API key — no OAuth. Validates the key live. */
  async connectStripeWithApiKey(currentWorkspace: CurrentWorkspace, userId: string, apiKey: string) {
    const { validateStripeApiKey, STRIPE_CAPABILITIES } = await import("./providers/stripe/stripeProvider.js");

    const existingIntegration = await this.getIntegration(currentWorkspace, "stripe");
    await new UsageService(this.db).assertIntegrationLimit(
      currentWorkspace.workspace,
      existingIntegration?.provider ?? null,
    );

    await validateStripeApiKey(apiKey);

    const integrationRef = this.collection(currentWorkspace.id).doc("stripe");
    const now = Timestamp.now();
    const existing = await integrationRef.get();

    const integration = integrationSchema.parse({
      id: "stripe",
      workspaceId: currentWorkspace.id,
      provider: "stripe",
      status: "connected",
      scopes: [],
      scopesGranted: [],
      tokenRef: integrationRef.path,
      capabilities: STRIPE_CAPABILITIES,
      syncError: null,
      connectedBy: userId,
      ownedByUserId: userId,
      lastSuccessfulRefreshAt: now,
      syncStatus: "idle",
      connectionGeneration:
        typeof existing.data()?.["connectionGeneration"] === "number"
          ? Number(existing.data()?.["connectionGeneration"]) + 1
          : 1,
      createdAt: existing.exists ? existing.data()?.["createdAt"] ?? now : now,
      updatedAt: now,
    });

    await integrationRef.set(
      {
        ...integration,
        encryptedToken: encryptJson({ raw: { apiKey } }),
      },
      { merge: true },
    );

    invalidateCachedCapabilities(currentWorkspace.id);
    invalidateCachedIntegrationsCount(currentWorkspace.id);

    await this.activityService.createEvent({
      workspaceId: currentWorkspace.id,
      type: existing.exists ? "integration.reconnected" : "integration.connected",
      title: existing.exists ? "Stripe reconnected" : "Stripe connected",
      actorType: "user",
      actorId: userId,
      related: { integrationId: "stripe" },
      metadata: { provider: "stripe" },
    });

    return { status: "connected" as const };
  }

  async handleOAuthCallback(
    providerId: string,
    input: { code?: string; state?: string; error?: string },
  ) {
    const normalizedProvider = normalizeIntegrationProviderId(providerId);
    const redirectBase =
      (normalizedProvider === "gmail"
        ? env.GMAIL_POST_AUTH_REDIRECT ?? env.GOOGLE_POST_AUTH_REDIRECT
        : normalizedProvider === "hubspot"
          ? env.HUBSPOT_POST_AUTH_REDIRECT
          : undefined) ?? `${env.FRONTEND_ORIGIN ?? "http://localhost:3000"}/integrations/${normalizedProvider}`;

    if (input.error) {
      return `${redirectBase}?status=error&message=${encodeURIComponent(input.error)}`;
    }

    if (!input.code || !input.state) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: "OAuth callback is missing code or state.",
        status: 400,
      });
    }

    const state = parseIntegrationOAuthState(input.state, normalizedProvider);
    const provider = createIntegrationProvider(this.db, normalizedProvider);
    const exchange = await provider.exchangeCode({ code: input.code, state: input.state });
    const integrationRef = this.collection(state.workspaceId).doc(normalizedProvider);
    const now = Timestamp.now();
    const existing = await integrationRef.get();

    const integration = integrationSchema.parse({
      id: normalizedProvider,
      workspaceId: state.workspaceId,
      provider: normalizedProvider,
      status: exchange.status,
      scopes: exchange.scopes,
      scopesGranted: exchange.scopes,
      tokenRef: integrationRef.path,
      capabilities: exchange.capabilities,
      lastSyncedAt: existing.data()?.["lastSyncedAt"],
      syncError: null,
      connectedBy: state.userId,
      ownedByUserId: state.userId,
      accountEmail:
        typeof exchange.metadata?.accountEmail === "string" ? exchange.metadata.accountEmail : undefined,
      accountEmailLower:
        typeof exchange.metadata?.accountEmail === "string"
          ? exchange.metadata.accountEmail.toLowerCase()
          : undefined,
      portalId:
        typeof exchange.metadata?.portalId === "number" ? exchange.metadata.portalId : undefined,
      tokenExpiresAt: exchange.tokenExpiresAt,
      lastSuccessfulRefreshAt: now,
      syncStatus: "idle",
      watchStatus: normalizedProvider === "gmail" ? "pending" : undefined,
      retentionDays: normalizedProvider === "gmail" ? 30 : undefined,
      connectionGeneration:
        typeof existing.data()?.["connectionGeneration"] === "number"
          ? Number(existing.data()?.["connectionGeneration"]) + 1
          : 1,
      createdAt: existing.exists ? existing.data()?.["createdAt"] ?? now : now,
      updatedAt: now,
    });

    await integrationRef.set(
      {
        ...integration,
        encryptedToken: exchange.tokenPayload ? encryptJson(exchange.tokenPayload) : null,
      },
      { merge: true },
    );

    if (normalizedProvider === "gmail") {
      await new GmailSyncService(this.db).initializeConnectionMetadata(state.workspaceId, normalizedProvider);
    }

    invalidateCachedCapabilities(state.workspaceId);
    invalidateCachedIntegrationsCount(state.workspaceId);

    await this.activityService.createEvent({
      workspaceId: state.workspaceId,
      type: existing.exists ? "integration.reconnected" : "integration.connected",
      title: existing.exists
        ? `${provider.displayName} reconnected`
        : `${provider.displayName} connected`,
      actorType: "user",
      actorId: state.userId,
      related: { integrationId: normalizedProvider },
      metadata: { provider: normalizedProvider, scopes: exchange.scopes },
    });

    return `${redirectBase}?status=connected&provider=${normalizedProvider}`;
  }

  async disconnectIntegration(currentWorkspace: CurrentWorkspace, providerId: string, userId: string) {
    const connection = await this.requireConnection(currentWorkspace, providerId);
    if (connection.provider === "gmail" || connection.provider === "google") {
      this.assertGmailOwner(userId, connection, "disconnect it");
    }
    const provider = createIntegrationProvider(this.db, connection.provider);
    await provider.disconnect(connection);
    if (connection.provider === "gmail") {
      await new GmailSyncService(this.db).purgeConnectionData(currentWorkspace.id, connection.id);
    } else if (connection.provider === "hubspot") {
      const deleted = await this.itemRepository.deleteByIntegration(currentWorkspace.id, connection.id, {
        provider: "hubspot",
        sourceTypes: ["crm_contact", "crm_company", "crm_deal", "crm_note", "crm_task"],
      });
      await new EmbeddingService(this.db).deleteBySources(
        currentWorkspace.id,
        "integration_item",
        deleted.itemIds,
      );
    }
    if (connection.provider === "gmail" || connection.provider === "hubspot") {
      await Promise.all([
        new IndexingLifecycleService(this.db).onProviderDisconnect(
          currentWorkspace.id,
          connection.provider,
        ),
        new IntegrationCacheCoherenceService(this.db).invalidateProvider(
          currentWorkspace.id,
          connection.provider,
          `${connection.provider}_disconnected`,
        ),
      ]);
    }

    await this.collection(currentWorkspace.id).doc(connection.id).set(
      {
        status: "disconnected",
        reconnectReason: null,
        syncError: null,
        watchStatus: null,
        watchHistoryId: null,
        lastHistoryId: null,
        watchExpiration: null,
        lastWatchRenewedAt: null,
        lastDeltaSyncedAt: null,
        fullResyncRequired: false,
        accountEmail: null,
        accountEmailLower: null,
        portalId: null,
        connectionGeneration: FieldValue.increment(1),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );

    invalidateCachedCapabilities(currentWorkspace.id);
    invalidateCachedIntegrationsCount(currentWorkspace.id);

    await this.activityService.createEvent({
      workspaceId: currentWorkspace.id,
      type: "integration.disconnected",
      title: `${provider.displayName} disconnected`,
      actorType: "user",
      actorId: userId,
      related: { integrationId: connection.id },
      metadata: { provider: provider.id },
    });

    return { status: "disconnected" as const };
  }

  async triggerSync(currentWorkspace: CurrentWorkspace, provider: string, userId: string) {
    const integration = await this.requireConnection(currentWorkspace, provider);
    if (integration.provider === "gmail" || integration.provider === "google") {
      this.assertGmailOwner(userId, integration, "refresh Gmail mailbox context");
    }

    await new UsageService(this.db).chargeOperation({
      workspace: currentWorkspace.workspace,
      userId,
      operationType: "integration_sync",
      metadata: { provider: integration.provider },
    });

    await this.collection(currentWorkspace.id).doc(integration.id).update({
      status: "syncing",
      syncStatus: "syncing",
      syncError: null,
      updatedAt: Timestamp.now(),
    });

    const job = await this.jobLockService.enqueueJob({
      workspaceId: currentWorkspace.id,
      jobType: "sync_integration",
      runId: integration.id,
      userId,
      input: { provider: integration.provider },
      dedupeKey: `sync_integration:${currentWorkspace.id}:${integration.provider}`,
    });

    await this.activityService.createEvent({
      workspaceId: currentWorkspace.id,
      type: "integration.sync_requested",
      title: `${integration.provider} sync queued`,
      actorType: "user",
      actorId: userId,
      related: { integrationId: integration.id },
      metadata: { jobId: job.id },
    });

    return {
      status: "queued" as const,
      jobId: job.id,
    };
  }
}
