/**
 * seedExpertSops
 *
 * Indexes expert capability SOPs into the IndexedSource store so they can be
 * matched semantically during intent routing.
 *
 * Usage:
 *   - Call `seedExpertSopsForWorkspace(db, workspaceId)` from backend boot or
 *     a script to ensure SOPs are indexed.
 *   - Idempotent: uses sourceHash to skip unchanged entries.
 *   - Only indexes capabilities with lifecycleStatus "active" or "shadow".
 */

import type { Firestore } from "firebase-admin/firestore";

import { expertCapabilities } from "../../experts/capabilityRegistry.js";
import { EmbeddingIndexService } from "./embeddingIndexService.js";
import { logger } from "../../observability/logger.js";

const SCHEMA_VERSION = "2026-05-expert-sop-v1";

/**
 * Composes the indexable text for a capability.
 * Combines all semantically useful fields so the vector captures the full
 * intent signature of the capability.
 */
function buildSopText(capability: (typeof expertCapabilities)[number]): string {
  const parts: string[] = [
    `Capability: ${capability.displayName}`,
    `Description: ${capability.description}`,
    `SOP: ${capability.sopText}`,
  ];

  if (capability.useCases.length > 0) {
    parts.push(`Use cases: ${capability.useCases.join(", ")}`);
  }
  if (capability.aliases.length > 0) {
    parts.push(`Also known as: ${capability.aliases.join(", ")}`);
  }
  if (capability.positiveExamples.length > 0) {
    parts.push(`Trigger examples: ${capability.positiveExamples.join(" | ")}`);
  }
  if (capability.negativeExamples.length > 0) {
    parts.push(`Does NOT match: ${capability.negativeExamples.join(" | ")}`);
  }
  if (capability.requiredContext.length > 0) {
    parts.push(`Required context: ${capability.requiredContext.join(", ")}`);
  }

  return parts.join("\n");
}

export async function seedExpertSopsForWorkspace(
  db: Firestore,
  workspaceId: string,
): Promise<{ indexed: number; skipped: number }> {
  const service = new EmbeddingIndexService(db);

  const eligible = expertCapabilities.filter(
    (c) => c.lifecycleStatus === "active" || c.lifecycleStatus === "shadow",
  );

  logger.info("seedExpertSops: starting SOP indexing", {
    workspaceId,
    total: eligible.length,
  });

  let indexed = 0;
  let skipped = 0;

  for (const capability of eligible) {
    try {
      const sopText = buildSopText(capability);

      await service.indexSource({
        workspaceId,
        sourceType: "expert_tool_sop",
        sourceId: `expert_sop:${capability.id}`,
        title: capability.displayName,
        summary: capability.description,
        contentChunk: sopText,
        metadata: {
          capabilityId: capability.id,
          group: capability.group,
          agentOwner: capability.agentOwner,
          secondaryAgents: capability.secondaryAgents ?? [],
          lifecycleStatus: capability.lifecycleStatus,
          rendererKey: capability.rendererKey,
          groundingPolicy: capability.groundingPolicy,
          requiredContext: capability.requiredContext,
          minimumConfidence: capability.minimumConfidence,
          schemaVersion: SCHEMA_VERSION,
        },
        permissions: {
          scope: "workspace",
        },
        provider: "internal",
        freshness: "fresh",
        retentionPolicy: {
          type: "durable",
        },
      });

      indexed++;
    } catch (err) {
      logger.warn("seedExpertSops: failed to index capability", {
        workspaceId,
        capabilityId: capability.id,
        error: err instanceof Error ? err.message : String(err),
      });
      skipped++;
    }
  }

  logger.info("seedExpertSops: SOP indexing complete", {
    workspaceId,
    indexed,
    skipped,
  });

  return { indexed, skipped };
}
