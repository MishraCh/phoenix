import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { ActivityService } from "../../../activity/activityService.js";
import { IntegrationItemRepository } from "../../../repositories/integrationItemRepository.js";
import { integrationSchema, type Integration } from "../../../schemas/coreSchemas.js";
import { ApiError } from "../../../utils/apiError.js";
import type { IntegrationConnection } from "../../core/integrationContracts.js";
import { HubSpotProvider, type HubSpotObjectType } from "./hubspotProvider.js";
import { logger } from "../../../observability/logger.js";

export class HubspotSyncService {
  private readonly provider: HubSpotProvider;
  private readonly itemRepository: IntegrationItemRepository;
  private readonly activityService: ActivityService;

  constructor(private readonly db: Firestore) {
    this.provider = new HubSpotProvider(db);
    this.itemRepository = new IntegrationItemRepository(db);
    this.activityService = new ActivityService(db);
  }

  private collection(workspaceId: string) {
    return this.db.collection("workspaces").doc(workspaceId).collection("integrations");
  }

  private async getConnection(workspaceId: string, connectionId = "hubspot") {
    const snapshot = await this.collection(workspaceId).doc(connectionId).get();

    if (!snapshot.exists) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "HubSpot connection not found.",
        status: 404,
      });
    }

    return integrationSchema.parse({ id: snapshot.id, ...snapshot.data() }) as IntegrationConnection;
  }

  private async updateConnection(workspaceId: string, connectionId: string, patch: Record<string, unknown>) {
    await this.collection(workspaceId).doc(connectionId).set(
      {
        ...patch,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  }

  private buildSyncItem(
    sourceType: "crm_contact" | "crm_company" | "crm_deal" | "crm_note" | "crm_task",
    record: Awaited<ReturnType<HubSpotProvider["searchRecords"]>>[number],
  ) {
    return {
      sourceType,
      externalId: record.id,
      title: record.title,
      summary: record.subtitle,
      normalizedData: record.properties,
    };
  }

  async manualRefresh(
    workspaceId: string,
    connectionId = "hubspot",
    userId?: string,
    options?: { hubspotModules?: Array<HubSpotObjectType> },
  ) {
    const connection = await this.getConnection(workspaceId, connectionId);

    const modules = options?.hubspotModules?.length
      ? options.hubspotModules
      : (["contacts", "companies", "deals", "notes", "tasks"] as const);

    const results = await Promise.all(
      modules.map(async (module) => ({
        module,
        records: await this.provider.searchRecords(connection, { objectType: module, limit: 100 }),
      })),
    );

    const items = results.flatMap(({ module, records }) =>
      module === "contacts"
        ? records.map((r) => this.buildSyncItem("crm_contact", r))
        : module === "companies"
          ? records.map((r) => this.buildSyncItem("crm_company", r))
          : module === "deals"
            ? records.map((r) => this.buildSyncItem("crm_deal", r))
            : module === "notes"
              ? records.map((r) => this.buildSyncItem("crm_note", r))
              : records.map((r) => this.buildSyncItem("crm_task", r)),
    );

    const syncResult = await this.itemRepository.syncItems(connection, items);

    await this.updateConnection(workspaceId, connectionId, {
      status: "connected",
      syncStatus: "idle",
      syncError: null,
      lastSyncedAt: Timestamp.now(),
      lastDeltaSyncedAt: Timestamp.now(),
    });

    await this.activityService.createEvent({
      workspaceId,
      type: "integration.synced",
      title: "hubspot sync completed",
      actorType: "system",
      actorId: userId,
      related: { integrationId: connectionId },
      metadata: { ...syncResult },
    });

    return { ...syncResult };
  }
}
