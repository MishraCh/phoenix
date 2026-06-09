import { z } from "zod";

import { commandOriginSurfaceSchema, routeDecisionSchema } from "./commandContracts.js";
import { sessionStateSnapshotSchema } from "./sessionState.js";

export const commandSelectedContextSchema = z.object({
  provider: z.enum(["gmail", "hubspot", "internal"]),
  objectType: z.string().min(1),
  id: z.string().min(1),
  label: z.string().min(1),
  explicitlySelected: z.boolean(),
});

export const commandRequestEnvelopeSchema = z.object({
  requestId: z.string().min(1),
  clientCommandId: z.string().min(1).optional(),
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  rawInput: z.string().min(1),
  normalizedInput: z.string().min(1),
  explicitMode: z.enum(["auto", "search", "research", "extract_url", "workflow"]).optional(),
  timezone: z.string().min(1).optional(),
  selectedAgentId: z.string().nullable(),
  originSurface: commandOriginSurfaceSchema,
  routeDecision: routeDecisionSchema.optional(),
  contextBundleId: z.string().nullable(),
  selectedContext: z.array(commandSelectedContextSchema).default([]),
  sessionState: sessionStateSnapshotSchema,
  attachments: z.array(z.unknown()).default([]),
  artifactRefs: z.array(z.string()).default([]),
  availableCapabilities: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
});

export type CommandRequestEnvelope = z.infer<typeof commandRequestEnvelopeSchema>;
