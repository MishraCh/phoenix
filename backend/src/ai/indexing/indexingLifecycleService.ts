/**
 * IndexingLifecycleService
 *
 * Phase 2: Retrieval Standardization lifecycle hooks.
 *
 * This service adds IndexedSource dual-write alongside the existing retrieval
 * paths. The old RetrievalService paths (artifact embedding into artifact doc,
 * session summary embedding into commandSessions doc) are preserved unchanged.
 * This service adds a parallel write to the new `indexedSources` subcollection.
 *
 * SAFE MIGRATION: Old retrieval reads from RetrievalService continue to work.
 * New semantic retrieval reads from EmbeddingIndexService. Both coexist until
 * Phase 5 (CommandGraph cleanup) completes retrieval parity verification.
 *
 * Hooks:
 *  - onArtifactCreated   — indexes artifact into IndexedSources
 *  - onArtifactDeleted   — purges artifact IndexedSources
 *  - onSessionSummarized — indexes session summary into IndexedSources
 *  - onMemoryCreated     — indexes memory node into IndexedSources
 *  - onMemoryDeleted     — purges memory IndexedSources
 *  - onMemoryUpdated     — re-indexes when content or status changes
 */

import type { Firestore } from "firebase-admin/firestore";

import { EmbeddingIndexService } from "./embeddingIndexService.js";
import { logger } from "../../observability/logger.js";

// ---------------------------------------------------------------------------
// Retention policies per source type (§4.3)
// ---------------------------------------------------------------------------

const ARTIFACT_RETENTION = { type: "durable" as const };
const SESSION_RETENTION = { type: "temporary" as const, defaultDays: 90 };
const MEMORY_RETENTION = { type: "durable" as const };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function artifactSourceId(workspaceId: string, artifactId: string): string {
  return `artifact:${workspaceId}:${artifactId}`;
}

function sessionSourceId(workspaceId: string, sessionId: string): string {
  return `session_summary:${workspaceId}:${sessionId}`;
}

function memorySourceId(workspaceId: string, memoryId: string): string {
  return `memory_fact:${workspaceId}:${memoryId}`;
}

function expiryDate(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class IndexingLifecycleService {
  private readonly indexService: EmbeddingIndexService;

  constructor(private readonly db: Firestore) {
    this.indexService = new EmbeddingIndexService(db);
  }

  // -------------------------------------------------------------------------
  // Artifact hooks
  // -------------------------------------------------------------------------

  /**
   * Called after an artifact is created or updated.
   * Fire-and-forget safe; never throws to caller.
   */
  async onArtifactCreated(input: {
    workspaceId: string;
    artifactId: string;
    title: string;
    content: string;
    artifactType: string;
    createdBy?: string;
  }): Promise<void> {
    try {
      await this.indexService.indexSource({
        workspaceId: input.workspaceId,
        sourceType: "artifact",
        sourceId: artifactSourceId(input.workspaceId, input.artifactId),
        title: input.title,
        summary: `Artifact of type "${input.artifactType}": ${input.content.slice(0, 200)}`,
        contentChunk: input.content.slice(0, 3000),
        metadata: {
          artifactId: input.artifactId,
          artifactType: input.artifactType,
          createdBy: input.createdBy ?? "unknown",
        },
        permissions: { scope: "workspace" },
        provider: "internal",
        freshness: "fresh",
        retentionPolicy: ARTIFACT_RETENTION,
      });
    } catch (err) {
      logger.warn("IndexingLifecycle: onArtifactCreated failed silently", {
        workspaceId: input.workspaceId,
        artifactId: input.artifactId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Called after an artifact is deleted.
   */
  async onArtifactDeleted(workspaceId: string, artifactId: string): Promise<void> {
    try {
      await this.indexService.deleteSource(
        artifactSourceId(workspaceId, artifactId),
        workspaceId,
        "artifact_deleted",
      );
    } catch (err) {
      logger.warn("IndexingLifecycle: onArtifactDeleted failed silently", {
        workspaceId,
        artifactId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Session summary hooks
  // -------------------------------------------------------------------------

  /**
   * Called after a session summary is compressed and written.
   */
  async onSessionSummarized(input: {
    workspaceId: string;
    sessionId: string;
    title: string;
    summary: string;
    plan?: "free" | "plus" | "pro";
  }): Promise<void> {
    const retentionDays = input.plan === "pro" ? 180 : input.plan === "plus" ? 90 : 30;

    try {
      await this.indexService.indexSource({
        workspaceId: input.workspaceId,
        sourceType: "session_summary",
        sourceId: sessionSourceId(input.workspaceId, input.sessionId),
        title: input.title,
        summary: input.summary.slice(0, 500),
        contentChunk: input.summary.slice(0, 2000),
        metadata: { sessionId: input.sessionId },
        permissions: { scope: "workspace" },
        provider: "internal",
        freshness: "fresh",
        expiresAt: expiryDate(retentionDays),
        retentionPolicy: SESSION_RETENTION,
      });
    } catch (err) {
      logger.warn("IndexingLifecycle: onSessionSummarized failed silently", {
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Memory hooks
  // -------------------------------------------------------------------------

  /**
   * Called after a memory node is created.
   */
  async onMemoryCreated(input: {
    workspaceId: string;
    memoryId: string;
    type: string;
    content: string;
    confidence?: number;
    status: string;
  }): Promise<void> {
    // Don't index needs_review memories as high-confidence workspace context
    const freshness = input.status === "active" ? "fresh" : ("stale" as const);

    try {
      await this.indexService.indexSource({
        workspaceId: input.workspaceId,
        sourceType: "memory_fact",
        sourceId: memorySourceId(input.workspaceId, input.memoryId),
        title: `Workspace memory (${input.type})`,
        summary: input.content.slice(0, 200),
        contentChunk: input.content,
        metadata: {
          memoryId: input.memoryId,
          memoryType: input.type,
          confidence: input.confidence ?? 0.8,
          status: input.status,
        },
        permissions: { scope: "workspace" },
        provider: "internal",
        freshness,
        retentionPolicy: MEMORY_RETENTION,
      });
    } catch (err) {
      logger.warn("IndexingLifecycle: onMemoryCreated failed silently", {
        workspaceId: input.workspaceId,
        memoryId: input.memoryId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Called when a memory node content or status changes.
   */
  async onMemoryUpdated(
    workspaceId: string,
    memoryId: string,
    updates: { content?: string; status?: string; confidence?: number },
  ): Promise<void> {
    try {
      const freshness =
        updates.status === "active" ? "fresh" : updates.status ? ("stale" as const) : undefined;

      await this.indexService.updateSource(
        memorySourceId(workspaceId, memoryId),
        workspaceId,
        {
          ...(updates.content
            ? {
                summary: updates.content.slice(0, 200),
                contentChunk: updates.content,
              }
            : {}),
          ...(freshness ? { freshness } : {}),
          ...(updates.content || updates.status || updates.confidence
            ? {
                metadata: {
                  memoryId,
                  ...(updates.status ? { status: updates.status } : {}),
                  ...(updates.confidence !== undefined ? { confidence: updates.confidence } : {}),
                },
              }
            : {}),
        },
      );
    } catch (err) {
      logger.warn("IndexingLifecycle: onMemoryUpdated failed silently", {
        workspaceId,
        memoryId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Called when a memory node is deleted.
   */
  async onMemoryDeleted(workspaceId: string, memoryId: string): Promise<void> {
    try {
      await this.indexService.deleteSource(
        memorySourceId(workspaceId, memoryId),
        workspaceId,
        "memory_deleted",
      );
    } catch (err) {
      logger.warn("IndexingLifecycle: onMemoryDeleted failed silently", {
        workspaceId,
        memoryId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Integration provider disconnect
  // -------------------------------------------------------------------------

  /**
   * Called on Gmail or HubSpot disconnect.
   * Purges all provider-owned indexed sources for the workspace.
   */
  async onProviderDisconnect(workspaceId: string, provider: "gmail" | "hubspot"): Promise<void> {
    try {
      const purged = await this.indexService.deleteByProvider(
        workspaceId,
        provider,
        `${provider}_disconnected`,
      );
      logger.info("IndexingLifecycle: provider sources purged on disconnect", {
        workspaceId,
        provider,
        purged,
      });
    } catch (err) {
      logger.warn("IndexingLifecycle: onProviderDisconnect failed silently", {
        workspaceId,
        provider,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
