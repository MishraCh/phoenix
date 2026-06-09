import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import { firestoreTimestampSchema, sourceRefSchema } from "../schemas/coreSchemas.js";

export const webCitationSchema = z.object({
  title: z.string().optional(),
  url: z.string().url().optional(),
  snippet: z.string().optional(),
  reasoning: z.string().optional(),
  field: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const webTaskCacheSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  taskHash: z.string().min(1),
  provider: z.string().min(1),
  prompt: z.string().min(1),
  processor: z.string().min(1),
  content: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]),
  contentText: z.string().min(1),
  contentHash: z.string().min(1),
  sourceRefs: z.array(sourceRefSchema),
  citations: z.array(webCitationSchema),
  confidence: z.number().min(0).max(1).optional(),
  completeness: z.number().min(0).max(1).optional(),
  freshness: z.enum(["fresh", "stale", "partial", "unknown"]).default("fresh"),
  failedSources: z.array(z.string()).default([]),
  cacheVersion: z.string().default("web-task-cache.v2"),
  providerConfigurationHash: z.string().optional(),
  taskRunId: z.string().optional(),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
  expiresAt: firestoreTimestampSchema,
});

export const webPageCacheSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  url: z.string().url(),
  urlHash: z.string().min(1),
  provider: z.string().min(1),
  sessionId: z.string().optional(),
  title: z.string().optional(),
  publishDate: z.string().optional(),
  excerpts: z.array(z.string()),
  fullContent: z.string().optional(),
  contentText: z.string().min(1),
  contentHash: z.string().min(1),
  sourceRefs: z.array(sourceRefSchema),
  freshness: z.enum(["fresh", "stale", "partial", "unknown"]).default("fresh"),
  cacheVersion: z.string().default("web-page-cache.v2"),
  providerConfigurationHash: z.string().optional(),
  createdAt: firestoreTimestampSchema,
  extractedAt: firestoreTimestampSchema,
  expiresAt: firestoreTimestampSchema,
});

export const webExtractionCacheSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  url: z.string().url(),
  schemaName: z.string().min(1),
  schemaVersion: z.string().min(1),
  inputHash: z.string().min(1),
  provider: z.string().optional(),
  taskRunId: z.string().optional(),
  output: z.record(z.string(), z.unknown()),
  sourceRefs: z.array(sourceRefSchema),
  createdAt: firestoreTimestampSchema,
  expiresAt: firestoreTimestampSchema,
});

export const webSourceSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  url: z.string().url(),
  domain: z.string().min(1),
  title: z.string().optional(),
  sourceType: z.enum(["search_result", "web_page", "document", "screenshot"]),
  provider: z.string().min(1),
  trustLevel: z.enum(["unknown", "low", "medium", "high"]),
  sourceRefs: z.array(sourceRefSchema).optional(),
  citations: z.array(webCitationSchema).optional(),
  confidence: z.number().min(0).max(1).optional(),
  lastFetchedAt: firestoreTimestampSchema,
  lastCheckedAt: firestoreTimestampSchema.optional(),
  contentHash: z.string().optional(),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export type WebCitation = z.infer<typeof webCitationSchema>;
export type WebTaskCache = z.infer<typeof webTaskCacheSchema>;
export type WebPageCache = z.infer<typeof webPageCacheSchema>;
export type WebExtractionCache = z.infer<typeof webExtractionCacheSchema>;
export type WebSource = z.infer<typeof webSourceSchema>;

export function createExpiryTimestamp(minutes: number) {
  return Timestamp.fromMillis(Date.now() + minutes * 60 * 1000);
}
