import { z } from "zod";

export const documentAnalysisSchema = z.object({
  status: z.enum(["success", "partial", "not_found", "connection_missing", "permission_missing", "error"]).default("success"),
  searchMetadata: z.object({
    query: z.string().optional(),
    sourceUsed: z.string().optional(),
    missingData: z.array(z.string()).optional(),
  }).optional(),
  summary: z.string().min(1).optional(),
  details: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type DocumentAnalysis = z.infer<typeof documentAnalysisSchema>;
