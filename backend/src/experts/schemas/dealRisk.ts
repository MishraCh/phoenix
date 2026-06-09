import { z } from "zod";

export const dealRiskSchema = z.object({
  status: z.enum(["success", "partial", "not_found", "connection_missing", "permission_missing", "error"]).default("success"),
  searchMetadata: z.object({
    query: z.string().optional(),
    sourceUsed: z.string().optional(),
    missingData: z.array(z.string()).optional(),
  }).optional(),
  summary: z.string().min(1).optional(),
  riskScore: z.number().min(0).max(100).optional(),
  riskFactors: z.array(z.string()).default([]).optional(),
  mitigatingFactors: z.array(z.string()).default([]).optional(),
  recommendedAction: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type DealRisk = z.infer<typeof dealRiskSchema>;
