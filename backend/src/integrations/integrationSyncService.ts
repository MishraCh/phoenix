import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { ActivityService } from "../activity/activityService.js";
import { NotificationService } from "../notifications/notificationService.js";
import { IntegrationItemRepository } from "../repositories/integrationItemRepository.js";
import { integrationSchema } from "../schemas/coreSchemas.js";
import { ApiError } from "../utils/apiError.js";
import { GmailSyncService } from "./providers/gmail/gmailSyncService.js";
import { HubSpotProvider } from "./providers/hubspot/hubspotProvider.js";
import { HubspotSyncService } from "./providers/hubspot/hubspotSyncService.js";

export class IntegrationSyncService {
  private readonly itemRepository: IntegrationItemRepository;
  private readonly activityService: ActivityService;
  private readonly notificationService: NotificationService;

  constructor(private readonly db: Firestore) {
    this.itemRepository = new IntegrationItemRepository(db);
    this.activityService = new ActivityService(db);
    this.notificationService = new NotificationService(db);
  }

  private collection(workspaceId: string) {
    return this.db.collection("workspaces").doc(workspaceId).collection("integrations");
  }

  private buildHubSpotSyncItems(
    sourceType: "crm_contact" | "crm_company" | "crm_deal" | "crm_note" | "crm_task",
    records: Awaited<ReturnType<HubSpotProvider["searchRecords"]>>,
  ) {
    return records.map((record) => ({
      sourceType,
      externalId: record.id,
      title: record.title,
      summary: record.subtitle,
      normalizedData: record.properties,
    }));
  }

  async syncIntegration(
    workspaceId: string,
    provider: string,
    userId?: string,
    options?: {
      hubspotModules?: Array<"contacts" | "companies" | "deals" | "notes" | "tasks">;
    },
  ) {
    const normalizedProvider = provider === "google" ? "gmail" : provider;
    const integrationSnapshot = await this.collection(workspaceId).doc(normalizedProvider).get();
    const legacySnapshot =
      !integrationSnapshot.exists && normalizedProvider === "gmail"
        ? await this.collection(workspaceId).doc("google").get()
        : null;
    const doc = integrationSnapshot.exists ? integrationSnapshot : legacySnapshot;
    const integration = doc?.exists
      ? integrationSchema.parse({ id: doc.id, ...doc.data() })
      : null;

    if (!integration) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: `Integration "${provider}" not found.`,
        status: 404,
      });
    }

    if (integration.status !== "connected" && integration.status !== "syncing") {
      throw new ApiError({
        code: "INTEGRATION_NOT_CONNECTED",
        message: `${provider} must be connected before it can sync.`,
        status: 409,
      });
    }

    try {
      let result;

      if (integration.provider === "gmail" || integration.provider === "google") {
        result = await new GmailSyncService(this.db).manualRefresh(workspaceId, integration.id, userId);
      } else if (integration.provider === "hubspot") {
        const hubspotSync = new HubspotSyncService(this.db);
        result = await hubspotSync.manualRefresh(workspaceId, integration.id, userId, {
          hubspotModules: options?.hubspotModules,
        });
      } else {
        throw new ApiError({
          code: "NOT_SUPPORTED",
          message: `Sync is not implemented for provider "${integration.provider}".`,
          status: 400,
        });
      }

      await this.collection(workspaceId).doc(integration.id).update({
        status: "connected",
        syncStatus: "idle",
        syncError: null,
        lastSyncedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      await this.activityService.createEvent({
        workspaceId,
        type: "integration.synced",
        title: `${integration.provider} sync completed`,
        actorType: "system",
        actorId: userId,
        related: { integrationId: integration.id },
        metadata: result,
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Integration sync failed.";

      await this.collection(workspaceId).doc(integration.id).update({
        status: "error",
        syncStatus: "error",
        syncError: message,
        updatedAt: Timestamp.now(),
      });
      await this.notificationService.createNotification({
        workspaceId,
        userId,
        type: "integration_error",
        title: "Integration sync failed",
        body: message,
        actionUrl: `/integrations/${integration.provider}`,
        related: { integrationId: integration.id },
      });

      throw error;
    }
  }
}
