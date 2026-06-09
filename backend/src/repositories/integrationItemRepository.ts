import { createHash } from "node:crypto";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import {
  integrationItemSchema,
  type Integration,
  type IntegrationItem,
} from "../schemas/coreSchemas.js";

export type NormalizedIntegrationItemInput = {
  sourceType: IntegrationItem["sourceType"];
  externalId: string;
  title?: string;
  normalizedData: Record<string, unknown>;
  summary?: string;
  expiresAt?: Timestamp;
};

export type IntegrationSyncResult = {
  integrationId: string;
  provider: string;
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
};

function hashSource(payload: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function buildItemId(integrationId: string, sourceType: string, externalId: string) {
  return createHash("sha256")
    .update(`${integrationId}:${sourceType}:${externalId}`)
    .digest("hex")
    .slice(0, 24);
}

export class IntegrationItemRepository {
  constructor(private readonly db: Firestore) {}

  private collection(workspaceId: string) {
    return this.db.collection("workspaces").doc(workspaceId).collection("integrationItems");
  }

  async listRecentByIntegration(workspaceId: string, integrationId: string, limit = 10) {
    const snapshot = await this.collection(workspaceId)
      .where("integrationId", "==", integrationId)
      .limit(limit)
      .get();

    return snapshot.docs
      .map((doc) => integrationItemSchema.parse({ id: doc.id, ...doc.data() }))
      .filter((item) => !item.expiresAt || item.expiresAt.toMillis() > Date.now())
      .sort((left, right) => right.updatedAt.toMillis() - left.updatedAt.toMillis());
  }

  async listByIntegration(workspaceId: string, integrationId: string, limit = 100) {
    const snapshot = await this.collection(workspaceId)
      .where("integrationId", "==", integrationId)
      .limit(limit)
      .get();

    return snapshot.docs
      .map((doc) => integrationItemSchema.parse({ id: doc.id, ...doc.data() }))
      .filter((item) => !item.expiresAt || item.expiresAt.toMillis() > Date.now())
      .sort((left, right) => right.updatedAt.toMillis() - left.updatedAt.toMillis());
  }

  async getByExternalId(
    workspaceId: string,
    integrationId: string,
    externalId: string,
    sourceType?: IntegrationItem["sourceType"],
  ) {
    if (sourceType) {
      const directSnapshot = await this.collection(workspaceId)
        .doc(buildItemId(integrationId, sourceType, externalId))
        .get();

      if (!directSnapshot.exists) {
        return null;
      }

      const direct = integrationItemSchema.parse({ id: directSnapshot.id, ...directSnapshot.data() });
      return !direct.expiresAt || direct.expiresAt.toMillis() > Date.now() ? direct : null;
    }

    const snapshot = await this.collection(workspaceId)
      .where("integrationId", "==", integrationId)
      .where("externalId", "==", externalId)
      .limit(10)
      .get();

    const match = snapshot.docs
      .map((doc) => integrationItemSchema.parse({ id: doc.id, ...doc.data() }))
      .find(
        (item) =>
          (!item.expiresAt || item.expiresAt.toMillis() > Date.now()) &&
          (!sourceType || item.sourceType === sourceType),
      );

    return match ?? null;
  }

  async deleteByIntegration(
    workspaceId: string,
    integrationId: string,
    options?: { provider?: string; sourceTypes?: IntegrationItem["sourceType"][] },
  ) {
    const snapshot = await this.collection(workspaceId)
      .where("integrationId", "==", integrationId)
      .limit(250)
      .get();

    if (snapshot.empty) {
      return { deleted: 0, itemIds: [] as string[] };
    }

    const docs = snapshot.docs
      .map((doc) => integrationItemSchema.parse({ id: doc.id, ...doc.data() }))
      .filter((item) => (options?.provider ? item.provider === options.provider : true))
      .filter((item) => (options?.sourceTypes?.length ? options.sourceTypes.includes(item.sourceType) : true));

    if (docs.length === 0) {
      return { deleted: 0, itemIds: [] as string[] };
    }

    const batch = this.db.batch();

    for (const item of docs) {
      batch.delete(this.collection(workspaceId).doc(item.id));
    }

    await batch.commit();

    return { deleted: docs.length, itemIds: docs.map((item) => item.id) };
  }

  async syncItems(
    integration: Pick<Integration, "id" | "workspaceId" | "provider">,
    items: NormalizedIntegrationItemInput[],
  ): Promise<IntegrationSyncResult> {
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const errors: string[] = [];

    for (const item of items) {
      const itemRef = this.collection(integration.workspaceId).doc(
        buildItemId(integration.id, item.sourceType, item.externalId),
      );

      try {
        const snapshot = await itemRef.get();
        const sourceHash = hashSource(item.normalizedData);
        const now = Timestamp.now();

        if (snapshot.exists) {
          const existing = integrationItemSchema.parse({ id: snapshot.id, ...snapshot.data() });

          if (existing.sourceHash === sourceHash) {
            unchanged += 1;
            const unchangedPayload: Record<string, unknown> = {
              lastSyncedAt: now,
              updatedAt: now,
            };

            if (item.expiresAt ?? existing.expiresAt) {
              unchangedPayload.expiresAt = item.expiresAt ?? existing.expiresAt;
            }

            await itemRef.update(unchangedPayload);
            continue;
          }

          const updatePayload: Record<string, unknown> = {
            title: item.title,
            normalizedData: item.normalizedData,
            summary: item.summary,
            sourceHash,
            lastSyncedAt: now,
            updatedAt: now,
          };

          if (item.expiresAt ?? existing.expiresAt) {
            updatePayload.expiresAt = item.expiresAt ?? existing.expiresAt;
          }

          await itemRef.update(updatePayload);
          updated += 1;
          continue;
        }

        const createdItem = integrationItemSchema.parse({
          id: itemRef.id,
          workspaceId: integration.workspaceId,
          integrationId: integration.id,
          provider: integration.provider,
          sourceType: item.sourceType,
          externalId: item.externalId,
          title: item.title,
          normalizedData: item.normalizedData,
          summary: item.summary,
          sourceHash,
          lastSyncedAt: now,
          createdAt: now,
          updatedAt: now,
          expiresAt: item.expiresAt,
        });

        await itemRef.set(createdItem);
        created += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Integration item sync failed.");
      }
    }

    return {
      integrationId: integration.id,
      provider: integration.provider,
      scanned: items.length,
      created,
      updated,
      unchanged,
      errors,
    };
  }
}
