import { z } from "zod";

export const accountSnapshotSchema = z.object({
  status: z.enum(["success", "partial", "not_found", "connection_missing", "permission_missing", "error"]).default("success"),
  searchMetadata: z.object({
    query: z.string().optional(),
    sourceUsed: z.string().optional(),
    missingData: z.array(z.string()).optional(),
  }).optional(),
  summary: z.string().min(1).optional(),
  crmHealth: z.enum(["healthy", "at_risk", "churned", "unknown"]).optional(),
  dealStage: z.string().optional(),
  lastActivity: z.string().optional(),
  owner: z.string().optional(),
  openTasks: z.array(z.string()).default([]).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type AccountSnapshot = z.infer<typeof accountSnapshotSchema>;
