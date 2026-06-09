import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { ActivityService } from "../../../activity/activityService.js";
import { EmbeddingService } from "../../../ai/embeddings/embeddingService.js";
import { IntegrationItemRepository } from "../../../repositories/integrationItemRepository.js";
import { integrationSchema, type Integration } from "../../../schemas/coreSchemas.js";
import { ApiError } from "../../../utils/apiError.js";
import type { IntegrationConnection } from "../../core/integrationContracts.js";
import { GmailProvider, type GmailThreadDetail } from "./gmailProvider.js";

const DEFAULT_RETENTION_DAYS = 30;

function nowPlusDays(days: number) {
  return Timestamp.fromMillis(Date.now() + days * 24 * 60 * 60 * 1000);
}

function toConnectionId(connection: Pick<Integration, "workspaceId" | "id">) {
  return `${connection.workspaceId}:${connection.id}`;
}

function parseHistoryId(value: string | undefined | null) {
  if (!value) {
    return null;
  }

  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function isHistoryExpiredError(error: unknown) {
  const status =
    typeof error === "object" && error && "status" in error
      ? (error as { status?: number }).status
      : typeof error === "object" && error && "code" in error
        ? Number((error as { code?: number | string }).code)
        : undefined;

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return status === 404 || message.includes("starthistoryid") || message.includes("history") && message.includes("expired");
}

export class GmailSyncService {
  private readonly provider: GmailProvider;
  private readonly itemRepository: IntegrationItemRepository;
  private readonly activityService: ActivityService;

  constructor(private readonly db: Firestore) {
    this.provider = new GmailProvider(db);
    this.itemRepository = new IntegrationItemRepository(db);
    this.activityService = new ActivityService(db);
  }

  private collection(workspaceId: string) {
    return this.db.collection("workspaces").doc(workspaceId).collection("integrations");
  }

  private async getConnection(workspaceId: string, connectionId = "gmail") {
    const snapshot = await this.collection(workspaceId).doc(connectionId).get();

    if (!snapshot.exists) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Gmail connection not found.",
        status: 404,
      });
    }

    return integrationSchema.parse({ id: snapshot.id, ...snapshot.data() }) as IntegrationConnection;
  }

  private buildThreadItem(connection: IntegrationConnection, thread: GmailThreadDetail) {
    const retentionDays = connection.retentionDays ?? DEFAULT_RETENTION_DAYS;
    const listItem = this.provider.buildThreadListItem(thread);

    return {
      sourceType: "email_thread" as const,
      externalId: thread.threadId,
      title: thread.subject,
      summary: thread.snippet,
      normalizedData: {
        ...thread,
        listItem,
      },
      expiresAt: nowPlusDays(retentionDays),
    };
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

  async findConnectionsByAccountEmail(emailAddress: string) {
    const normalized = emailAddress.trim().toLowerCase();

    if (!normalized) {
      return [] as IntegrationConnection[];
    }

    const snapshot = await this.db
      .collectionGroup("integrations")
      .where("accountEmailLower", "==", normalized)
      .limit(20)
      .get();

    return snapshot.docs.map((doc) =>
      integrationSchema.parse({ id: doc.id, ...doc.data() }) as IntegrationConnection,
    );
  }

  async initializeConnectionMetadata(workspaceId: string, connectionId = "gmail") {
    const connection = await this.getConnection(workspaceId, connectionId);
    let accountEmail = connection.accountEmail ?? null;
    let accountEmailLower = connection.accountEmailLower ?? null;
    let watchStatus: "active" | "pending" | "error" = "pending";
    let watchHistoryId: string | null = null;
    let lastHistoryId: string | null = null;
    let watchExpiration: Timestamp | null = null;
    let lastWatchRenewedAt: Timestamp | null = null;
    let reconnectReason: string | null = connection.reconnectReason ?? null;
    let lastErrorCode: string | null = connection.lastErrorCode ?? null;

    try {
      const profile = await this.provider.getMailboxProfile(connection);
      if (profile.emailAddress) {
        accountEmail = profile.emailAddress;
        accountEmailLower = profile.emailAddress.toLowerCase();
      }
      if (profile.historyId) {
        lastHistoryId = profile.historyId;
      }
    } catch (error) {
      reconnectReason = error instanceof Error ? error.message : "Unable to read Gmail mailbox profile.";
      lastErrorCode = "gmail_profile_failed";
    }

    try {
      const watch = await this.provider.setupWatch(connection);
      watchStatus = "active";
      watchHistoryId = watch.historyId || lastHistoryId;
      lastHistoryId = watch.historyId || lastHistoryId;
      watchExpiration = watch.expiration;
      lastWatchRenewedAt = Timestamp.now();
      reconnectReason = null;
      lastErrorCode = null;
    } catch (error) {
      watchStatus = lastHistoryId ? "pending" : "error";
      reconnectReason = error instanceof Error ? error.message : "Gmail watch setup failed.";
      lastErrorCode = "gmail_watch_setup_failed";
    }

    if (!accountEmailLower && watchStatus === "active") {
      watchStatus = "pending";
      reconnectReason = reconnectReason ?? "Gmail mailbox profile could not be resolved for push sync routing.";
      lastErrorCode = lastErrorCode ?? "gmail_profile_missing";
    }

    await this.updateConnection(workspaceId, connectionId, {
      accountEmail,
      accountEmailLower,
      retentionDays: connection.retentionDays ?? DEFAULT_RETENTION_DAYS,
      watchStatus,
      watchHistoryId,
      lastHistoryId,
      watchExpiration,
      lastWatchRenewedAt,
      reconnectReason,
      lastErrorCode,
      fullResyncRequired: false,
    });
  }

  async manualRefresh(workspaceId: string, connectionId = "gmail", userId?: string) {
    const connection = await this.getConnection(workspaceId, connectionId);
    const threads = await this.provider.listRecentInboxThreads(connection, {
      maxResults: 20,
    });
    let profileEmail = connection.accountEmail ?? null;
    let profileHistoryId = connection.lastHistoryId ?? connection.watchHistoryId ?? null;

    try {
      const profile = await this.provider.getMailboxProfile(connection);
      profileEmail = profile.emailAddress || profileEmail;
      profileHistoryId = profile.historyId ?? profileHistoryId;
    } catch {
      // Manual refresh still succeeds even if profile metadata cannot be refreshed right now.
    }

    const result = await this.itemRepository.syncItems(
      connection,
      threads.map((thread) => this.buildThreadItem(connection, thread)),
    );

    await this.updateConnection(workspaceId, connectionId, {
      status: "connected",
      syncStatus: "idle",
      syncError: null,
      lastSyncedAt: Timestamp.now(),
      lastDeltaSyncedAt: Timestamp.now(),
      lastHistoryId: profileHistoryId,
      accountEmail: profileEmail,
      accountEmailLower: profileEmail ? profileEmail.toLowerCase() : connection.accountEmailLower ?? null,
      fullResyncRequired: false,
    });

    await this.activityService.createEvent({
      workspaceId,
      type: "integration.synced",
      title: "gmail sync completed",
      actorType: "system",
      actorId: userId,
      related: { integrationId: connectionId },
      metadata: result,
    });

    return result;
  }

  async processHistory(workspaceId: string, connectionId: string, incomingHistoryId: string, userId?: string) {
    const connection = await this.getConnection(workspaceId, connectionId);
    const storedHistoryId = connection.lastHistoryId ?? connection.watchHistoryId ?? null;
    const incoming = parseHistoryId(incomingHistoryId);
    const stored = parseHistoryId(storedHistoryId);

    if (!storedHistoryId || !stored) {
      await this.updateConnection(workspaceId, connectionId, {
        fullResyncRequired: true,
        syncStatus: "error",
        syncError: "Gmail history baseline is missing. Run a manual refresh to recover.",
      });

      return {
        connectionId: toConnectionId(connection),
        processed: false,
        reason: "missing_history_baseline",
      };
    }

    if (incoming && stored && incoming <= stored) {
      return {
        connectionId: toConnectionId(connection),
        processed: false,
        reason: "duplicate_or_stale_history",
      };
    }

    try {
      const threadIds = new Set<string>();
      let pageToken: string | undefined;
      let latestHistoryId = storedHistoryId;

      do {
        const page = await this.provider.listHistory(connection, {
          startHistoryId: storedHistoryId,
          pageToken,
        });
        page.changedThreadIds.forEach((threadId) => threadIds.add(threadId));
        latestHistoryId = page.historyId ?? latestHistoryId;
        pageToken = page.nextPageToken ?? undefined;
      } while (pageToken);

      const changedThreads = await Promise.all(
        Array.from(threadIds).map(async (threadId) => this.provider.getThread(connection, threadId)),
      );

      const result = await this.itemRepository.syncItems(
        connection,
        changedThreads.map((thread) => this.buildThreadItem(connection, thread)),
      );

      await this.updateConnection(workspaceId, connectionId, {
        status: "connected",
        syncStatus: "idle",
        syncError: null,
        fullResyncRequired: false,
        lastHistoryId: latestHistoryId ?? incomingHistoryId,
        lastDeltaSyncedAt: Timestamp.now(),
        lastSyncedAt: Timestamp.now(),
      });

      await this.activityService.createEvent({
        workspaceId,
        type: "integration.delta_synced",
        title: "gmail delta sync completed",
        actorType: "system",
        actorId: userId,
        related: { integrationId: connectionId },
        metadata: {
          ...result,
          incomingHistoryId,
          changedThreads: changedThreads.length,
        },
      });

      return {
        connectionId: toConnectionId(connection),
        processed: true,
        incomingHistoryId,
        latestHistoryId: latestHistoryId ?? incomingHistoryId,
        ...result,
      };
    } catch (error) {
      if (isHistoryExpiredError(error)) {
        await this.updateConnection(workspaceId, connectionId, {
          fullResyncRequired: true,
          syncStatus: "error",
          syncError: "Gmail history expired. Run a manual refresh to catch up.",
        });

        return {
          connectionId: toConnectionId(connection),
          processed: false,
          reason: "history_expired",
        };
      }

      throw error;
    }
  }

  async renewExpiringWatches(hoursAhead = 48) {
    const snapshot = await this.db
      .collectionGroup("integrations")
      .where("provider", "==", "gmail")
      .limit(100)
      .get();

    const cutoff = Date.now() + hoursAhead * 60 * 60 * 1000;
    let scanned = 0;
    let renewed = 0;
    let failed = 0;

    for (const doc of snapshot.docs) {
      const connection = integrationSchema.parse({ id: doc.id, ...doc.data() }) as IntegrationConnection;
      scanned += 1;

      if (connection.status !== "connected") {
        continue;
      }

      const watchExpiration = connection.watchExpiration?.toMillis() ?? 0;
      if (watchExpiration > cutoff && connection.watchStatus === "active") {
        continue;
      }

      try {
        const watch = await this.provider.renewWatch(connection);
        await this.updateConnection(connection.workspaceId, connection.id, {
          watchStatus: "active",
          watchHistoryId: watch.historyId || (connection.watchHistoryId ?? null),
          lastHistoryId: watch.historyId || (connection.lastHistoryId ?? null),
          watchExpiration: watch.expiration,
          lastWatchRenewedAt: Timestamp.now(),
          reconnectReason: null,
          lastErrorCode: null,
        });
        renewed += 1;
      } catch (error) {
        failed += 1;
        await this.updateConnection(connection.workspaceId, connection.id, {
          watchStatus: "error",
          reconnectReason: error instanceof Error ? error.message : "Gmail watch renewal failed.",
          lastErrorCode: "gmail_watch_renew_failed",
        });
      }
    }

    return { scanned, renewed, failed };
  }

  async purgeConnectionData(workspaceId: string, connectionId = "gmail") {
    const deletedItems = await this.itemRepository.deleteByIntegration(workspaceId, connectionId, {
      provider: "gmail",
      sourceTypes: ["email_thread", "email"],
    });

    if (deletedItems.itemIds.length > 0) {
      try {
        await new EmbeddingService(this.db).deleteBySources(
          workspaceId,
          "integration_item",
          deletedItems.itemIds,
        );
      } catch {
        // Embeddings are optional; purge raw cache even when embeddings are unavailable.
      }
    }

    return deletedItems;
  }
}
