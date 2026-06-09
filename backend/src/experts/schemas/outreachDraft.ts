import { z } from "zod";

export const outreachDraftSchema = z.object({
  status: z.enum(["ready", "missing_context", "partial", "not_found", "error"]).default("ready"),
  clarificationQuestion: z.string().optional(),
  missingFields: z.array(z.string()).optional(),
  searchMetadata: z.object({
    query: z.string().optional(),
    sourceUsed: z.string().optional(),
    missingData: z.array(z.string()).optional(),
  }).optional(),
  summary: z.string().optional(),
  audience: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  rationale: z.array(z.string()).optional(),
  variants: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
});

export type OutreachDraft = z.infer<typeof outreachDraftSchema>;

