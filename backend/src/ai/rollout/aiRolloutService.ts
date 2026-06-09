import { createHash } from "node:crypto";

import type { Firestore } from "firebase-admin/firestore";

import { env } from "../../config/env.js";

export const aiRolloutFlagNames = [
  "AI_TRACE_V2",
  "SESSION_STATE_V2",
  "ROUTE_V2_SHADOW",
  "ROUTE_V2_ACTIVE",
  "CONTEXT_V2",
  "EXECUTION_V2",
  "RETRIEVAL_V2_SHADOW",
  "RETRIEVAL_V2_ACTIVE",
  "EXPERT_V2",
  "RESEARCH_V2",
  "WORKFLOW_V2",
] as const;
export type AiRolloutFlag = (typeof aiRolloutFlagNames)[number];

type RolloutConfiguration = {
  flags?: Partial<Record<AiRolloutFlag, boolean>>;
  percentages?: Partial<Record<AiRolloutFlag, number>>;
};

const cache = new Map<string, { expiresAt: number; value: RolloutConfiguration }>();

function stablePercentage(workspaceId: string, flag: AiRolloutFlag) {
  const digest = createHash("sha256").update(`${workspaceId}:${flag}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export class AiRolloutService {
  constructor(private readonly db: Firestore) {}

  private async workspaceConfiguration(workspaceId: string): Promise<RolloutConfiguration> {
    const cached = cache.get(workspaceId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const snapshot = await this.db
      .collection("workspaces")
      .doc(workspaceId)
      .collection("settings")
      .doc("aiRollout")
      .get();
    const value = snapshot.exists ? (snapshot.data() as RolloutConfiguration) : {};
    cache.set(workspaceId, { expiresAt: Date.now() + 60_000, value });
    return value;
  }

  async isEnabled(flag: AiRolloutFlag, workspaceId: string) {
    if (env.AI_V2_KILL_SWITCH) return false;

    const workspace = await this.workspaceConfiguration(workspaceId);
    const explicitOverride = workspace.flags?.[flag];
    if (typeof explicitOverride === "boolean") return explicitOverride;

    const percentage = workspace.percentages?.[flag] ?? env[`${flag}_PERCENT`];
    if (percentage > 0) {
      return stablePercentage(workspaceId, flag) < percentage;
    }

    return env[flag];
  }
}
