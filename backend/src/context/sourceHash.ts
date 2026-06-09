import { createHash } from "node:crypto";

export function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function contextInputHash(input: {
  key: string;
  purpose: string;
  sourceRefs?: unknown[];
  payload?: unknown;
  sourceRevisions?: Record<string, string>;
  providerConfigurationHash?: string | null;
  connectionGenerationId?: string | null;
}) {
  return stableHash({
    key: input.key.trim().toLowerCase(),
    purpose: input.purpose.trim().toLowerCase(),
    sourceRefs: input.sourceRefs ?? [],
    payload: input.payload ?? {},
    sourceRevisions: input.sourceRevisions ?? {},
    providerConfigurationHash: input.providerConfigurationHash ?? null,
    connectionGenerationId: input.connectionGenerationId ?? null,
  });
}

export function sourceHash(sourceType: string, sourceId: string) {
  return stableHash(`${sourceType}:${sourceId}`);
}
