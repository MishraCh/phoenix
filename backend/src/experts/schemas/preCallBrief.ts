import { z } from "zod";

export const preCallBriefSchema = z.object({
  status: z.enum(["success", "partial", "not_found", "connection_missing", "permission_missing", "error"]).default("success"),
  searchMetadata: z.object({
    query: z.string().optional(),
    sourceUsed: z.string().optional(),
    missingData: z.array(z.string()).optional(),
  }).optional(),
  objective: z.string().min(1).optional(),
  accountContext: z.string().min(1).optional(),
  likelyObjections: z.array(z.string().min(1)).default([]).optional(),
  suggestedQuestions: z.array(z.string().min(1)).min(1).optional(),
  openingLines: z.array(z.string().min(1)).min(1).optional(),
  successCriteria: z.array(z.string().min(1)).min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type PreCallBrief = z.infer<typeof preCallBriefSchema>;

