import { z } from "zod";

export const pipelineHealthSchema = z.object({
  status: z.enum(["success", "partial", "not_found", "connection_missing", "permission_missing", "error"]).default("success"),
  searchMetadata: z.object({
    query: z.string().optional(),
    sourceUsed: z.string().optional(),
    missingData: z.array(z.string()).optional(),
  }).optional(),
  summary: z.string().min(1).optional(),
  dealCount: z.number().int().min(0).optional(),
  totalValue: z.string().optional(),
  atRiskDeals: z.number().int().min(0).optional(),
  velocity: z.string().optional(),
  funnelStages: z.array(z.object({
    stageName: z.string(),
    count: z.number(),
    value: z.string().optional(),
  })).default([]).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type PipelineHealth = z.infer<typeof pipelineHealthSchema>;
