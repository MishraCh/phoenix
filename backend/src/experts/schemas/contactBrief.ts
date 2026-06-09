import { z } from "zod";

export const contactBriefSchema = z.object({
  status: z.enum(["ready", "missing_context", "partial", "not_found", "error"]).default("ready"),
  clarificationQuestion: z.string().optional(),
  missingFields: z.array(z.string()).optional(),
  searchMetadata: z.object({
    query: z.string().optional(),
    sourceUsed: z.string().optional(),
    missingData: z.array(z.string()).optional(),
  }).optional(),
  summary: z.string().optional(),
  buyerContext: z.string().optional(),
  painPoints: z.array(z.string()).optional(),
  signals: z.array(z.string()).optional(),
  recommendedAngle: z.string().optional(),
  risks: z.array(z.string()).default([]),
  nextActions: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type ContactBrief = z.infer<typeof contactBriefSchema>;

