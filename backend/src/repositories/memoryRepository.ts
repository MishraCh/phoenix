import { createHash } from "node:crypto";

import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

import {
  memoryNodeSchema,
  type MemoryNode,
  type MemoryNodeSource,
  type MemoryNodeStatus,
  type MemoryNodeType,
} from "../schemas/coreSchemas.js";
import { assertWorkspaceScoped, snapshotToData, workspaceCollection } from "./firestoreRepository.js";

export function hashMemoryContent(source: MemoryNodeSource, sourceId: string, content: string): string {
  const prefix = content.trim().slice(0, 200);
  return createHash("sha256").update(`${source}:${sourceId}:${prefix}`).digest("hex");
}

export class MemoryRepository {
  constructor(private readonly db: Firestore) {}

  private collection(workspaceId: string) {
    return workspaceCollection(this.db, workspaceId, "memory");
  }

  async create(workspaceId: string, data: Omit<MemoryNode, "createdAt" | "updatedAt">): Promise<MemoryNode> {
    const now = Timestamp.now();
    const full: MemoryNode = { ...data, createdAt: now, updatedAt: now };
    assertWorkspaceScoped(full, workspaceId);
    memoryNodeSchema.parse(full);
    await this.collection(workspaceId).doc(full.id).set(full);
    return full;
  }

  async get(workspaceId: string, memoryId: string): Promise<MemoryNode | null> {
    const snap = await this.collection(workspaceId).doc(memoryId).get();
    if (!snap.exists) return null;
    const data = memoryNodeSchema.parse({ id: snap.id, ...snap.data() });
    assertWorkspaceScoped(data, workspaceId);
    return data;
  }

  async list(
    workspaceId: string,
    options: { status?: MemoryNodeStatus; type?: MemoryNodeType; limit?: number } = {},
  ): Promise<MemoryNode[]> {
    const limit = options.limit ?? 100;
    const snapshot = await this.collection(workspaceId).orderBy("createdAt", "desc").limit(limit + 50).get();
    return snapshot.docs
      .map((doc) => {
        const data = snapshotToData(doc, memoryNodeSchema);
        assertWorkspaceScoped(data, workspaceId);
        return data;
      })
      .filter((n) => (options.status ? n.status === options.status : true))
      .filter((n) => (options.type ? n.type === options.type : true))
      .slice(0, limit);
  }

  async listActive(workspaceId: string, limit = 50): Promise<MemoryNode[]> {
    return this.list(workspaceId, { status: "active", limit });
  }

  async update(
    workspaceId: string,
    memoryId: string,
    updates: Partial<Pick<MemoryNode, "status" | "content" | "confidence">>,
  ): Promise<void> {
    await this.collection(workspaceId).doc(memoryId).update({
      ...updates,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async delete(workspaceId: string, memoryId: string): Promise<void> {
    await this.collection(workspaceId).doc(memoryId).delete();
  }

  async existsByHash(workspaceId: string, sourceHash: string): Promise<boolean> {
    const snap = await this.collection(workspaceId).where("sourceHash", "==", sourceHash).limit(1).get();
    return !snap.empty;
  }
}
