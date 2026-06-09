import { z } from "zod";

import { sourceRefSchema } from "../../schemas/coreSchemas.js";
import { commandIntentSchema, commandResultKindSchema, resolvedEntitySchema } from "./commandContracts.js";

export const sessionSelectedRefSchema = z.object({
  provider: z.enum(["gmail", "hubspot", "internal"]),
  objectType: z.string().min(1),
  id: z.string().min(1),
  label: z.string().min(1),
  explicitlySelected: z.boolean(),
  selectedAtTurn: z.number().int().nonnegative(),
});

export const sessionResultProjectionSchema = z.object({
  messageId: z.string().min(1),
  resultKind: commandResultKindSchema,
  rendererKey: z.string().optional(),
  title: z.string().optional(),
  entityIds: z.array(z.string()).default([]),
  sourceRefs: z.array(sourceRefSchema).default([]),
  compactPayload: z.record(z.string(), z.unknown()).default({}),
});

export const disambiguationCandidateSchema = z.object({
  provider: z.enum(["gmail", "hubspot"]),
  objectType: z.string().min(1),
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

export const pendingDisambiguationSchema = z.object({
  query: z.string().min(1),
  candidates: z.array(disambiguationCandidateSchema).min(2),
  createdAtTurn: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
});

export const pendingSessionActionSchema = z.object({
  actionType: z.string().min(1),
  provider: z.enum(["gmail", "hubspot"]),
  targetId: z.string().optional(),
  targetLabel: z.string().optional(),
  input: z.record(z.string(), z.unknown()).default({}),
  createdAtTurn: z.number().int().nonnegative(),
});

export const sessionStateSnapshotSchema = z.object({
  revision: z.number().int().nonnegative().default(0),
  turn: z.number().int().nonnegative().default(0),
  activeEntities: z.array(resolvedEntitySchema.extend({
    sourceTurn: z.number().int().nonnegative(),
    expiresAfterTurn: z.number().int().nonnegative().optional(),
  })).default([]),
  selectedRefs: z.array(sessionSelectedRefSchema).default([]),
  recentResults: z.array(sessionResultProjectionSchema).max(6).default([]),
  pendingDisambiguation: pendingDisambiguationSchema.optional(),
  pendingAction: pendingSessionActionSchema.optional(),
  sessionSummary: z.string().default(""),
  lastIntent: commandIntentSchema.optional(),
  lastCapability: z.string().optional(),
  updatedAt: z.string().datetime(),
});
export type SessionStateSnapshot = z.infer<typeof sessionStateSnapshotSchema>;

export function emptySessionState(turn = 0): SessionStateSnapshot {
  return {
    revision: 0,
    turn,
    activeEntities: [],
    selectedRefs: [],
    recentResults: [],
    sessionSummary: "",
    updatedAt: new Date().toISOString(),
  };
}
