import { Timestamp } from "firebase-admin/firestore";

import type { SourceRef } from "../../schemas/coreSchemas.js";
import type { IntegrationContextBlock, SelectedItemContext } from "../core/integrationContracts.js";

export function buildIntegrationSourceRef(input: {
  provider: string;
  sourceId: string;
  title: string;
  url?: string | null;
  confidence?: number;
}): SourceRef {
  return {
    sourceType: "integration",
    sourceId: input.sourceId,
    title: input.title,
    url: input.url ?? undefined,
    provider: input.provider,
    fetchedAt: Timestamp.now(),
    confidence: input.confidence ?? 0.88,
    freshness: "fresh",
    citations: [],
    taskRunId: undefined,
    sessionId: undefined,
  };
}

export function buildSelectedItemContext(input: {
  provider: SelectedItemContext["provider"];
  itemId: string;
  itemType: string;
  title: string;
  summary: string;
  content: string;
  metadata?: Record<string, unknown>;
  sourceRefs: SourceRef[];
}): SelectedItemContext {
  return {
    provider: input.provider,
    itemId: input.itemId,
    itemType: input.itemType,
    title: input.title,
    summary: input.summary,
    content: input.content,
    metadata: input.metadata,
    sourceRefs: input.sourceRefs,
  };
}

export function buildIntegrationContextBlock(input: {
  provider: SelectedItemContext["provider"];
  status: IntegrationContextBlock["status"];
  title: string;
  selectedItem?: SelectedItemContext;
  limitations?: string[];
}): IntegrationContextBlock {
  return {
    provider: input.provider,
    status: input.status,
    title: input.title,
    selectedItem: input.selectedItem,
    limitations: input.limitations ?? [],
  };
}
