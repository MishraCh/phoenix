/**
 * EmbeddingIndexService
 *
 * Unified service that owns all IndexedSource write and search operations.
 * This is the Phase 1 foundation for the semantic architecture migration
 * (see docs/gideon_semantic_architecture_migration_guide.md §5).
 *
 * IMPORTANT: This does NOT replace the existing services/retrievalService.ts.
 * Both coexist during Phase 1. The existing retrieval paths continue to work.
 * This service adds a new unified indexedSources subcollection alongside them.
 */

import crypto from "crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

import { createEmbeddingProvider } from "../providers/providerRegistry.js";
import type { EmbeddingProvider } from "../providers/embeddingProvider.js";
import {
  indexedSourceSchema,
  type IndexedSource,
  type IndexedSourceType,
} from "../../schemas/coreSchemas.js";
import { logger } from "../../observability/logger.js";

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export type IndexedSourceInput = {
  workspaceId: string;
  userId?: string;
  sourceType: IndexedSourceType;
  sourceId: string;
  title: string;
  summary: string;
  contentChunk: string;
  chunkIndex?: number;
  metadata: Record<string, unknown>;
  permissions: {
    scope: "workspace" | "user" | "role";
    allowedUserIds?: string[];
    allowedRoles?: string[];
  };
  provider?: "gmail" | "hubspot" | "internal" | "upload" | "workflow";
  freshness?: "fresh" | "stale" | "unknown";
  expiresAt?: Date;
  retentionPolicy?: {
    type: "temporary" | "durable" | "workspace_configurable";
    defaultDays?: number;
  };
  sourceRevision?: string;
  connectionGenerationId?: string;
};

export type IndexedSearchInput = {
  workspaceId: string;
  userId?: string;
  query: string;
  topK?: number;
  sourceTypes?: IndexedSourceType[];
  provider?: "gmail" | "hubspot" | "internal" | "upload" | "workflow";
  excludeExpired?: boolean;
  userRole?: string;
};

export type IndexedSearchResult = {
  source: IndexedSource;
  score: number;
};

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = "2026-05-semantic-v1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sourceHash(input: { contentChunk: string; summary: string }): string {
  return crypto
    .createHash("sha256")
    .update(`${input.summary}||${input.contentChunk}`)
    .digest("hex")
    .slice(0, 32);
}

function collectionRef(db: Firestore, workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("indexedSources");
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class EmbeddingIndexService {
  private readonly provider: EmbeddingProvider;

  constructor(private readonly db: Firestore) {
    this.provider = createEmbeddingProvider();
  }

  /**
   * Index a source. Idempotent: if a document with the same sourceId and
   * sourceHash already exists, it is returned unchanged (no re-embedding).
   */
  async indexSource(input: IndexedSourceInput): Promise<IndexedSource> {
    const hash = sourceHash(input);
    const col = collectionRef(this.db, input.workspaceId);

    // Check for existing unchanged record
    const existingSnap = await col
      .where("sourceId", "==", input.sourceId)
      .where("sourceHash", "==", hash)
      .where("deletedAt", "==", null)
      .limit(1)
      .get()
      .catch(() =>
        // If compound query fails (index not ready), skip the staleness check
        null,
      );

    if (existingSnap && !existingSnap.empty) {
      const data = existingSnap.docs[0].data();
      return indexedSourceSchema.parse({ ...data, id: existingSnap.docs[0].id });
    }

    // Generate embedding
    const textToEmbed = [input.title, input.summary, input.contentChunk]
      .filter(Boolean)
      .join("\n\n");

    let embedding: number[] | undefined;
    try {
      const vectors = await this.provider.embed([textToEmbed]);
      embedding = vectors[0];
    } catch (err) {
      logger.warn("EmbeddingIndexService: embedding failed, storing without vector", {
        workspaceId: input.workspaceId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const now = Timestamp.now();
    const docRef = col.doc();

    const record = {
      id: docRef.id,
      workspaceId: input.workspaceId,
      ...(input.userId ? { userId: input.userId } : {}),
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceHash: hash,
      schemaVersion: SCHEMA_VERSION,
      ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
      ...(input.connectionGenerationId
        ? { connectionGenerationId: input.connectionGenerationId }
        : {}),
      title: input.title,
      summary: input.summary,
      contentChunk: input.contentChunk,
      ...(input.chunkIndex !== undefined ? { chunkIndex: input.chunkIndex } : {}),
      metadata: input.metadata,
      permissions: input.permissions,
      ...(input.provider ? { provider: input.provider } : {}),
      freshness: input.freshness ?? "fresh",
      createdAt: now,
      updatedAt: now,
      ...(input.expiresAt ? { expiresAt: Timestamp.fromDate(input.expiresAt) } : {}),
      ...(input.retentionPolicy ? { retentionPolicy: input.retentionPolicy } : {}),
    };

    // Store with Firestore VectorValue if we have an embedding
    await docRef.set({
      ...record,
      ...(embedding ? { embedding: FieldValue.vector(embedding) } : {}),
    });

    logger.debug("EmbeddingIndexService: indexed source", {
      workspaceId: input.workspaceId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      hasEmbedding: !!embedding,
    });

    return indexedSourceSchema.parse({ ...record, ...(embedding ? { embedding } : {}) });
  }

  /**
   * Update an existing source. Re-embeds if content changed.
   */
  async updateSource(sourceId: string, workspaceId: string, input: Partial<IndexedSourceInput>): Promise<void> {
    const col = collectionRef(this.db, workspaceId);
    const snap = await col.where("sourceId", "==", sourceId).limit(1).get();

    if (snap.empty) {
      logger.warn("EmbeddingIndexService: updateSource — source not found, indexing fresh", {
        workspaceId,
        sourceId,
      });
      if (
        input.sourceType &&
        input.title &&
        input.summary !== undefined &&
        input.contentChunk !== undefined &&
        input.metadata &&
        input.permissions
      ) {
        await this.indexSource(input as IndexedSourceInput);
      }
      return;
    }

    const doc = snap.docs[0];
    const existing = doc.data();
    const updates: Record<string, unknown> = { updatedAt: Timestamp.now() };

    if (input.title) updates.title = input.title;
    if (input.summary !== undefined) updates.summary = input.summary;
    if (input.contentChunk !== undefined) updates.contentChunk = input.contentChunk;
    if (input.metadata) updates.metadata = input.metadata;
    if (input.freshness) updates.freshness = input.freshness;

    // Re-embed if content changed
    const newSummary = String(input.summary ?? existing["summary"] ?? "");
    const newChunk = String(input.contentChunk ?? existing["contentChunk"] ?? "");
    const newHash = sourceHash({ summary: newSummary, contentChunk: newChunk });

    if (newHash !== existing["sourceHash"]) {
      updates.sourceHash = newHash;
      try {
        const textToEmbed = [
          String(input.title ?? existing["title"] ?? ""),
          newSummary,
          newChunk,
        ]
          .filter(Boolean)
          .join("\n\n");
        const vectors = await this.provider.embed([textToEmbed]);
        const embedding = vectors[0];
        if (embedding) {
          updates.embedding = FieldValue.vector(embedding);
        }
      } catch (err) {
        logger.warn("EmbeddingIndexService: re-embed failed on update", {
          workspaceId,
          sourceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await doc.ref.update(updates);
  }

  /**
   * Soft-delete a single source by its Firestore sourceId.
   */
  async deleteSource(sourceId: string, workspaceId: string, reason: string): Promise<void> {
    const col = collectionRef(this.db, workspaceId);
    const snap = await col.where("sourceId", "==", sourceId).limit(10).get();

    if (snap.empty) return;

    const batch = this.db.batch();
    const now = Timestamp.now();
    for (const doc of snap.docs) {
      batch.update(doc.ref, { deletedAt: now, deleteReason: reason, updatedAt: now });
    }
    await batch.commit();
  }

  /**
   * Purge all indexed sources for a given provider in a workspace.
   * Called when a user/workspace disconnects an integration.
   */
  async deleteByProvider(workspaceId: string, provider: string, reason: string): Promise<number> {
    const col = collectionRef(this.db, workspaceId);
    const snap = await col.where("provider", "==", provider).get();

    if (snap.empty) return 0;

    const batch = this.db.batch();
    const now = Timestamp.now();
    for (const doc of snap.docs) {
      batch.update(doc.ref, { deletedAt: now, deleteReason: reason, updatedAt: now });
    }
    await batch.commit();

    logger.info("EmbeddingIndexService: purged provider sources", {
      workspaceId,
      provider,
      count: snap.size,
      reason,
    });

    return snap.size;
  }

  /**
   * Cleanup hook: soft-delete all sources past their expiresAt.
   * Called by background worker.
   */
  async deleteExpiredSources(workspaceId?: string): Promise<number> {
    const now = Timestamp.now();
    let query = workspaceId
      ? collectionRef(this.db, workspaceId).where("expiresAt", "<=", now)
      : (this.db.collectionGroup("indexedSources") as FirebaseFirestore.Query).where("expiresAt", "<=", now);

    query = query.where("deletedAt", "==", null);

    const snap = await query.limit(500).get();
    if (snap.empty) return 0;

    const batch = this.db.batch();
    for (const doc of snap.docs) {
      batch.update(doc.ref, {
        deletedAt: now,
        deleteReason: "expired",
        updatedAt: now,
      });
    }
    await batch.commit();

    logger.info("EmbeddingIndexService: expired sources cleaned up", { count: snap.size });
    return snap.size;
  }

  /**
   * Semantic search over IndexedSources.
   * Enforces workspace isolation and permission scope server-side.
   * Falls back gracefully if embedding provider is not configured.
   */
  async search(input: IndexedSearchInput): Promise<IndexedSearchResult[]> {
    const {
      workspaceId,
      userId,
      query,
      topK = 6,
      sourceTypes,
      provider,
      excludeExpired = true,
      userRole,
    } = input;

    let queryVector: number[] | undefined;
    try {
      const vectors = await this.provider.embed([query]);
      queryVector = vectors[0];
    } catch {
      logger.debug("EmbeddingIndexService: search — no embedding, returning empty", { workspaceId });
      return [];
    }

    if (!queryVector) return [];

    const col = collectionRef(this.db, workspaceId);
    const now = Timestamp.now();

    try {
      // Fetch candidate set via vector search
      const vectorQuery = col.findNearest({
        vectorField: "embedding",
        queryVector: FieldValue.vector(queryVector),
        limit: Math.min(topK * 4, 100),
        distanceMeasure: "COSINE",
        distanceResultField: "vectorDistance",
      });

      const snap = await vectorQuery.get();
      const results: IndexedSearchResult[] = [];

      for (const doc of snap.docs) {
        const data = doc.data();

        // Permission check: user-scoped sources must match userId
        const permissions = data["permissions"] as
          | {
              scope?: string;
              allowedUserIds?: string[];
              allowedRoles?: string[];
            }
          | undefined;
        if (
          permissions?.scope === "user" &&
          data["userId"] !== userId &&
          !permissions.allowedUserIds?.includes(userId ?? "")
        ) continue;
        if (
          permissions?.scope === "role" &&
          (!userRole || !permissions.allowedRoles?.includes(userRole))
        ) continue;

        // Source type filter
        if (sourceTypes && !sourceTypes.includes(data["sourceType"] as IndexedSourceType)) {
          continue;
        }

        // Provider filter
        if (provider && data["provider"] !== provider) {
          continue;
        }

        // Exclude soft-deleted
        if (data["deletedAt"]) {
          continue;
        }

        // Exclude expired
        if (excludeExpired && data["expiresAt"] && data["expiresAt"].toMillis() <= now.toMillis()) {
          continue;
        }

        const distance = typeof data["vectorDistance"] === "number" ? data["vectorDistance"] : 1;
        const score = 1 - Math.min(Math.max(distance, 0), 2) / 2;

        try {
          const source = indexedSourceSchema.parse({ ...data, id: doc.id });
          results.push({ source, score });
        } catch {
          // Skip malformed records
          continue;
        }

        if (results.length >= topK) break;
      }

      return results.sort((a, b) => b.score - a.score).slice(0, topK);
    } catch (err) {
      logger.warn("EmbeddingIndexService: vector search failed", {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * List sources by type (metadata-only, no vector search).
   */
  async listByType(
    workspaceId: string,
    sourceType: IndexedSourceType,
    limit = 50,
  ): Promise<IndexedSource[]> {
    const snap = await collectionRef(this.db, workspaceId)
      .where("sourceType", "==", sourceType)
      .where("deletedAt", "==", null)
      .limit(limit)
      .get()
      .catch(() => null);

    if (!snap) return [];

    const results: IndexedSource[] = [];
    for (const doc of snap.docs) {
      try {
        results.push(indexedSourceSchema.parse({ ...doc.data(), id: doc.id }));
      } catch {
        // skip malformed
      }
    }
    return results;
  }
}
