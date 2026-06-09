import { randomUUID } from "node:crypto";

import type { Firestore } from "firebase-admin/firestore";

import {
  getCachedMemory,
  invalidateCachedMemory,
  setCachedMemory,
} from "../cache/requestStateCache.js";
import { logger } from "../observability/logger.js";
import { hashMemoryContent, MemoryRepository } from "../repositories/memoryRepository.js";
import type {
  MemoryNode,
  MemoryNodeSource,
  MemoryNodeStatus,
  MemoryNodeType,
} from "../schemas/coreSchemas.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { IndexingLifecycleService } from "../ai/indexing/indexingLifecycleService.js";
import { ApiError } from "../utils/apiError.js";

type CreateMemoryInput = {
  type: MemoryNodeType;
  content: string;
  source: MemoryNodeSource;
  sourceId?: string;
  confidence?: number;
  status?: MemoryNodeStatus;
};

export class MemoryService {
  private readonly repo: MemoryRepository;

  constructor(private readonly db: Firestore) {
    this.repo = new MemoryRepository(db);
  }

  async create(workspace: CurrentWorkspace, input: CreateMemoryInput): Promise<MemoryNode> {
    const sourceId = input.sourceId ?? "manual";
    const sourceHash = hashMemoryContent(input.source, sourceId, input.content);

    const alreadyExists = await this.repo.existsByHash(workspace.id, sourceHash);
    if (alreadyExists) {
      throw new ApiError({
        code: "CONFLICT",
        message: "A memory node with identical content from this source already exists.",
        status: 409,
      });
    }

    const node = await this.repo.create(workspace.id, {
      id: randomUUID(),
      workspaceId: workspace.id,
      type: input.type,
      content: input.content,
      source: input.source,
      sourceId,
      confidence: input.confidence ?? 0.8,
      status: input.status ?? "active",
      sourceHash,
    });
    
    // Phase 2: Index into unified store
    void new IndexingLifecycleService(this.db).onMemoryCreated({
      workspaceId: workspace.id,
      memoryId: node.id,
      type: node.type,
      content: node.content,
      confidence: node.confidence,
      status: node.status,
    });

    invalidateCachedMemory(workspace.id);
    return node;
  }

  async createFromPromotion(
    workspaceId: string,
    input: CreateMemoryInput & { sourceId: string },
  ): Promise<MemoryNode | null> {
    const sourceHash = hashMemoryContent(input.source, input.sourceId, input.content);
    const alreadyExists = await this.repo.existsByHash(workspaceId, sourceHash);
    if (alreadyExists) {
      logger.debug("memory promotion skipped: duplicate hash", { workspaceId, sourceHash });
      return null;
    }
    try {
      const node = await this.repo.create(workspaceId, {
        id: randomUUID(),
        workspaceId,
        type: input.type,
        content: input.content,
        source: input.source,
        sourceId: input.sourceId,
        confidence: input.confidence ?? 0.7,
        status: "needs_review",
        sourceHash,
      });

      // Phase 2: Index into unified store
      void new IndexingLifecycleService(this.db).onMemoryCreated({
        workspaceId,
        memoryId: node.id,
        type: node.type,
        content: node.content,
        confidence: node.confidence,
        status: node.status,
      });

      invalidateCachedMemory(workspaceId);
      return node;
    } catch (err) {
      logger.warn("memory promotion failed", {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async list(
    workspace: CurrentWorkspace,
    options: { status?: MemoryNodeStatus; type?: MemoryNodeType; limit?: number } = {},
  ): Promise<MemoryNode[]> {
    let allNodes: MemoryNode[];
    const cached = getCachedMemory(workspace.id);
    if (cached) {
      allNodes = cached;
    } else {
      allNodes = await this.repo.list(workspace.id, { limit: 200 });
      setCachedMemory(workspace.id, allNodes);
    }
    const limit = options.limit ?? 100;
    return allNodes
      .filter((n) => (options.status ? n.status === options.status : true))
      .filter((n) => (options.type ? n.type === options.type : true))
      .slice(0, limit);
  }

  async listActive(workspace: CurrentWorkspace, limit = 50): Promise<MemoryNode[]> {
    return this.repo.listActive(workspace.id, limit);
  }

  async update(
    workspace: CurrentWorkspace,
    memoryId: string,
    updates: { status?: MemoryNodeStatus; content?: string; confidence?: number },
  ): Promise<MemoryNode> {
    const existing = await this.repo.get(workspace.id, memoryId);
    if (!existing) {
      throw new ApiError({ code: "NOT_FOUND", message: "Memory node not found.", status: 404 });
    }
    await this.repo.update(workspace.id, memoryId, updates);

    // Phase 2: Update in unified store
    void new IndexingLifecycleService(this.db).onMemoryUpdated(workspace.id, memoryId, updates);

    invalidateCachedMemory(workspace.id);
    return { ...existing, ...updates };
  }

  async delete(workspace: CurrentWorkspace, memoryId: string): Promise<void> {
    const existing = await this.repo.get(workspace.id, memoryId);
    if (!existing) {
      throw new ApiError({ code: "NOT_FOUND", message: "Memory node not found.", status: 404 });
    }
    await this.repo.delete(workspace.id, memoryId);

    // Phase 2: Purge from unified store
    void new IndexingLifecycleService(this.db).onMemoryDeleted(workspace.id, memoryId);

    invalidateCachedMemory(workspace.id);
  }

  serializeNode(node: MemoryNode) {
    return {
      id: node.id,
      type: node.type,
      content: node.content,
      source: node.source,
      sourceId: node.sourceId ?? null,
      confidence: node.confidence,
      status: node.status,
      createdAt: node.createdAt.toDate().toISOString(),
      updatedAt: node.updatedAt.toDate().toISOString(),
    };
  }
}
