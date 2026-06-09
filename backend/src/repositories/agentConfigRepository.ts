import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { getCachedAgentConfigs, invalidateCachedAgentConfigs, setCachedAgentConfigs } from "../cache/requestStateCache.js";
import { agentConfigSchema, type AgentConfig } from "../schemas/coreSchemas.js";
import { workspaceCollection } from "./firestoreRepository.js";

export class AgentConfigRepository {
  constructor(private readonly db: Firestore) {}

  private collection(workspaceId: string) {
    return workspaceCollection(this.db, workspaceId, "agentConfigs");
  }

  async get(workspaceId: string, agentId: string): Promise<AgentConfig | null> {
    const snapshot = await this.collection(workspaceId).doc(agentId).get();
    if (!snapshot.exists) return null;
    return agentConfigSchema.parse({ agentId: snapshot.id, workspaceId, ...snapshot.data() });
  }

  async list(workspaceId: string): Promise<AgentConfig[]> {
    const cached = getCachedAgentConfigs(workspaceId);
    if (cached) return cached;

    const snapshot = await this.collection(workspaceId).get();
    const configs = snapshot.docs.map((doc) =>
      agentConfigSchema.parse({ agentId: doc.id, workspaceId, ...doc.data() }),
    );
    setCachedAgentConfigs(workspaceId, configs);
    return configs;
  }

  async upsert(
    workspaceId: string,
    agentId: string,
    updates: Partial<Pick<AgentConfig, "status" | "systemPromptAddition" | "allowedTools" | "contextBundleId">>,
  ): Promise<AgentConfig> {
    const ref = this.collection(workspaceId).doc(agentId);
    const payload: Record<string, unknown> = {
      workspaceId,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.systemPromptAddition !== undefined) payload.systemPromptAddition = updates.systemPromptAddition;
    if ("allowedTools" in updates) payload.allowedTools = updates.allowedTools ?? null;
    if (updates.contextBundleId !== undefined) payload.contextBundleId = updates.contextBundleId;

    await ref.set(payload, { merge: true });
    invalidateCachedAgentConfigs(workspaceId);

    const fresh = await ref.get();
    return agentConfigSchema.parse({ agentId: fresh.id, workspaceId, ...fresh.data() });
  }
}
