import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { workspaceCollection } from "./firestoreRepository.js";
import { monitoredSourceSchema, type MonitoredSource } from "../schemas/coreSchemas.js";

type CreateMonitoredSourceInput = {
  workspaceId: string;
  type: MonitoredSource["type"];
  value: string;
  frequency: MonitoredSource["frequency"];
  workflowId?: string;
  provider?: string;
  createdBy: string;
};

type UpdateMonitoredSourceInput = Partial<
  Pick<
    MonitoredSource,
    "status" | "frequency" | "lastCheckedAt" | "lastChangedAt" | "lastContentHash" | "provider"
  >
>;

export class MonitoredSourceRepository {
  constructor(private readonly db: Firestore) {}

  private collection(workspaceId: string) {
    return workspaceCollection(this.db, workspaceId, "monitoredSources");
  }

  async create(input: CreateMonitoredSourceInput): Promise<MonitoredSource> {
    const ref = this.collection(input.workspaceId).doc();
    const now = Timestamp.now();
    const source = monitoredSourceSchema.parse({
      id: ref.id,
      workspaceId: input.workspaceId,
      type: input.type,
      value: input.value,
      frequency: input.frequency,
      status: "active",
      provider: input.provider,
      workflowId: input.workflowId,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });

    await ref.set(source);
    return source;
  }

  async getById(workspaceId: string, sourceId: string): Promise<MonitoredSource | null> {
    const snapshot = await this.collection(workspaceId).doc(sourceId).get();

    if (!snapshot.exists) {
      return null;
    }

    return monitoredSourceSchema.parse({ id: snapshot.id, ...snapshot.data() });
  }

  async listByWorkspace(workspaceId: string): Promise<MonitoredSource[]> {
    const snapshot = await this.collection(workspaceId).orderBy("createdAt", "desc").limit(100).get();
    return snapshot.docs.map((doc) => monitoredSourceSchema.parse({ id: doc.id, ...doc.data() }));
  }

  async update(
    workspaceId: string,
    sourceId: string,
    updates: UpdateMonitoredSourceInput,
  ): Promise<MonitoredSource> {
    const ref = this.collection(workspaceId).doc(sourceId);
    const existing = await ref.get();

    if (!existing.exists) {
      throw new Error(`MonitoredSource ${sourceId} not found.`);
    }

    const current = monitoredSourceSchema.parse({ id: existing.id, ...existing.data() });
    const updated = monitoredSourceSchema.parse({
      ...current,
      ...updates,
      updatedAt: Timestamp.now(),
    });

    await ref.set(updated);
    return updated;
  }
}
