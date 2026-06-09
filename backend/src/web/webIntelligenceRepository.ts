import { createHash } from "node:crypto";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { sourceRefSchema, type SourceRef } from "../schemas/coreSchemas.js";
import { workspaceCollection } from "../repositories/firestoreRepository.js";
import {
  createExpiryTimestamp,
  webExtractionCacheSchema,
  webPageCacheSchema,
  webSourceSchema,
  webTaskCacheSchema,
  type WebCitation,
  type WebExtractionCache,
  type WebPageCache,
  type WebSource,
  type WebTaskCache,
} from "./webIntelligenceSchemas.js";

type SaveTaskCacheInput = Omit<WebTaskCache, "id" | "createdAt" | "updatedAt" | "expiresAt"> & {
  ttlMinutes?: number;
};

type SavePageCacheInput = Omit<WebPageCache, "id" | "createdAt" | "extractedAt" | "expiresAt"> & {
  ttlMinutes?: number;
};

type SaveExtractionCacheInput = Omit<WebExtractionCache, "id" | "createdAt" | "expiresAt"> & {
  ttlMinutes?: number;
};

function hashId(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isFresh(expiresAt: Timestamp) {
  return expiresAt.toMillis() > Date.now();
}

export class WebIntelligenceRepository {
  constructor(private readonly db: Firestore) {}

  private taskCacheCollection(workspaceId: string) {
    return workspaceCollection(this.db, workspaceId, "webTaskCache");
  }

  private pageCacheCollection(workspaceId: string) {
    return workspaceCollection(this.db, workspaceId, "webPageCache");
  }

  private extractionCacheCollection(workspaceId: string) {
    return workspaceCollection(this.db, workspaceId, "webExtractionCache");
  }

  private sourceCollection(workspaceId: string) {
    return workspaceCollection(this.db, workspaceId, "webSources");
  }

  async getFreshTaskCache(workspaceId: string, taskHash: string): Promise<WebTaskCache | null> {
    const snapshot = await this.taskCacheCollection(workspaceId).doc(taskHash).get();

    if (!snapshot.exists) {
      return null;
    }

    const cache = webTaskCacheSchema.parse({ id: snapshot.id, ...snapshot.data() });
    return isFresh(cache.expiresAt) ? cache : null;
  }

  async getLatestTaskCache(workspaceId: string, taskHash: string): Promise<WebTaskCache | null> {
    const snapshot = await this.taskCacheCollection(workspaceId).doc(taskHash).get();

    if (!snapshot.exists) {
      return null;
    }

    return webTaskCacheSchema.parse({ id: snapshot.id, ...snapshot.data() });
  }

  async saveTaskCache(input: SaveTaskCacheInput): Promise<WebTaskCache> {
    const now = Timestamp.now();
    const cache = webTaskCacheSchema.parse({
      id: input.taskHash,
      ...input,
      sourceRefs: input.sourceRefs.map((sourceRef) => sourceRefSchema.parse(sourceRef)),
      createdAt: now,
      updatedAt: now,
      expiresAt: createExpiryTimestamp(input.ttlMinutes ?? 60 * 12),
    });

    await this.taskCacheCollection(input.workspaceId).doc(cache.id).set(cache);
    return cache;
  }

  async getFreshPageCache(workspaceId: string, urlHash: string): Promise<WebPageCache | null> {
    const snapshot = await this.pageCacheCollection(workspaceId).doc(urlHash).get();

    if (!snapshot.exists) {
      return null;
    }

    const cache = webPageCacheSchema.parse({ id: snapshot.id, ...snapshot.data() });
    return isFresh(cache.expiresAt) ? cache : null;
  }

  async getLatestPageCache(workspaceId: string, urlHash: string): Promise<WebPageCache | null> {
    const snapshot = await this.pageCacheCollection(workspaceId).doc(urlHash).get();

    if (!snapshot.exists) {
      return null;
    }

    return webPageCacheSchema.parse({ id: snapshot.id, ...snapshot.data() });
  }

  async savePageCache(input: SavePageCacheInput): Promise<WebPageCache> {
    const now = Timestamp.now();
    const cache = webPageCacheSchema.parse({
      id: input.urlHash,
      ...input,
      sourceRefs: input.sourceRefs.map((sourceRef) => sourceRefSchema.parse(sourceRef)),
      createdAt: now,
      extractedAt: now,
      expiresAt: createExpiryTimestamp(input.ttlMinutes ?? 60 * 6),
    });

    await this.pageCacheCollection(input.workspaceId).doc(cache.id).set(cache);
    return cache;
  }

  async getStructuredExtractionCache(
    workspaceId: string,
    inputHash: string,
  ): Promise<WebExtractionCache | null> {
    const snapshot = await this.extractionCacheCollection(workspaceId).doc(inputHash).get();

    if (!snapshot.exists) {
      return null;
    }

    const cache = webExtractionCacheSchema.parse({ id: snapshot.id, ...snapshot.data() });
    return isFresh(cache.expiresAt) ? cache : null;
  }

  async saveStructuredExtractionCache(input: SaveExtractionCacheInput): Promise<WebExtractionCache> {
    const now = Timestamp.now();
    const cache = webExtractionCacheSchema.parse({
      id: input.inputHash,
      ...input,
      sourceRefs: input.sourceRefs.map((sourceRef) => sourceRefSchema.parse(sourceRef)),
      createdAt: now,
      expiresAt: createExpiryTimestamp(input.ttlMinutes ?? 60 * 24),
    });

    await this.extractionCacheCollection(input.workspaceId).doc(cache.id).set(cache);
    return cache;
  }

  async upsertSources(
    workspaceId: string,
    provider: string,
    sourceRefs: SourceRef[],
    citations: WebCitation[],
    contentHash?: string,
  ) {
    const now = Timestamp.now();

    await Promise.all(
      sourceRefs
        .filter((sourceRef) => sourceRef.url)
        .map(async (sourceRef) => {
          const sourceUrl = sourceRef.url;

          if (!sourceUrl) {
            return;
          }

          const sourceId = hashId(`${provider}:${sourceRef.url}`);
          const source = webSourceSchema.parse({
            id: sourceId,
            workspaceId,
            url: sourceUrl,
            domain: new URL(sourceUrl).hostname,
            title: sourceRef.title,
            sourceType: "web_page",
            provider,
            trustLevel: "unknown",
            sourceRefs: [sourceRef],
            citations: citations.filter((citation) => citation.url === sourceRef.url),
            confidence: sourceRef.confidence,
            lastFetchedAt: now,
            lastCheckedAt: now,
            contentHash,
            createdAt: now,
            updatedAt: now,
          });

          await this.sourceCollection(workspaceId).doc(sourceId).set(source, { merge: true });
        }),
    );
  }
}
