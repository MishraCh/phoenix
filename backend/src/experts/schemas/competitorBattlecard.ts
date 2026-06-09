import { z } from "zod";

export const competitorBattlecardSchema = z.object({
  status: z.enum(["ready", "missing_context", "partial", "not_found", "error"]).default("ready"),
  clarificationQuestion: z.string().optional(),
  missingFields: z.array(z.string()).optional(),
  searchMetadata: z.object({
    query: z.string().optional(),
    sourceUsed: z.string().optional(),
    missingData: z.array(z.string()).optional(),
  }).optional(),
  summary: z.string().optional(),
  competitorOverview: z.string().optional(),
  strengths: z.array(z.string()).optional(),
  weaknesses: z.array(z.string()).optional(),
  positioningGap: z.string().optional(),
  attackAngles: z.array(z.string()).optional(),
  watchItems: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
});

export type CompetitorBattlecard = z.infer<typeof competitorBattlecardSchema>;

