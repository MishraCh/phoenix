import { z } from "zod";

export const commandOriginSurfaceSchema = z.enum([
  "command_center",
  "gmail_workspace",
  "hubspot_workspace",
  "workflow",
  "workflow_run",
  "library",
  "api",
]);
export type CommandOriginSurface = z.infer<typeof commandOriginSurfaceSchema>;

export const commandIntentSchema = z.enum([
  "normal_answer",
  "integration_read",
  "integration_write",
  "expert_capability",
  "web_search",
  "deep_research",
  "workflow_create",
  "workflow_run",
  "artifact_query",
  "memory_query",
  "clarification_needed",
]);
export type CommandIntent = z.infer<typeof commandIntentSchema>;

export const toolStrategySchema = z.enum([
  "none",
  "integration_read",
  "web_search",
  "deep_research",
  "external_action",
  "workflow",
]);
export type ToolStrategy = z.infer<typeof toolStrategySchema>;

export const commandResultKindSchema = z.enum([
  "answer",
  "integration_records",
  "expert",
  "research",
  "clarification",
  "approval",
  "workflow",
  "workflow_draft",
  "capability_guide",
  "error",
]);
export type CommandResultKind = z.infer<typeof commandResultKindSchema>;

export const resolvedEntitySchema = z.object({
  provider: z.enum(["gmail", "hubspot", "internal", "web"]).optional(),
  objectType: z.string().min(1),
  id: z.string().min(1),
  label: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  source: z.enum(["selected", "session", "query", "tool"]),
});
export type ResolvedEntity = z.infer<typeof resolvedEntitySchema>;

export const routeDecisionSchema = z.object({
  routeId: z.string().min(1),
  intent: commandIntentSchema,
  toolStrategy: toolStrategySchema,
  provider: z.enum(["gmail", "hubspot"]).optional(),
  objectType: z.string().optional(),
  action: z.string().optional(),
  actionInput: z.record(z.string(), z.unknown()).default({}),
  expertCapabilityId: z.string().optional(),
  resolvedEntities: z.array(resolvedEntitySchema).default([]),
  confidence: z.number().min(0).max(1),
  missingRequirements: z.array(z.string()).default([]),
  clarificationQuestion: z.string().optional(),
  expectedResultKind: commandResultKindSchema,
  routeSource: z.enum([
    "hard_rule",
    "selected_context",
    "session_context",
    "classifier",
    "semantic_match",
    "fallback",
  ]),
  reason: z.string().min(1),
});
export type RouteDecision = z.infer<typeof routeDecisionSchema>;

export const partialResultMetadataSchema = z.object({
  completeness: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  freshness: z.enum(["fresh", "stale", "partial", "missing", "unknown"]),
  failedSources: z.array(z.string()).default([]),
});
export type PartialResultMetadata = z.infer<typeof partialResultMetadataSchema>;
