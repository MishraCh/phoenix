import { z } from "zod";

export const opportunityScorecardSchema = z.object({
  status: z.enum(["ready", "missing_context", "partial", "not_found", "error"]).default("ready"),
  clarificationQuestion: z.string().optional(),
  missingFields: z.array(z.string()).optional(),
  searchMetadata: z.object({
    query: z.string().optional(),
    sourceUsed: z.string().optional(),
    missingData: z.array(z.string()).optional(),
  }).optional(),
  summary: z.string().optional(),
  opportunityScore: z.number().min(0).max(100).optional(),
  whyNow: z.array(z.string()).optional(),
  accountSignals: z.array(z.string()).optional(),
  recommendedPlay: z.string().optional(),
  risks: z.array(z.string()).default([]),
  nextSteps: z.array(z.string()).optional(),
  crmActionHints: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
});

export type OpportunityScorecard = z.infer<typeof opportunityScorecardSchema>;

