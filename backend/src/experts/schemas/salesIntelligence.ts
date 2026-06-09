import { z } from "zod";

export const salesIntelligenceSchema = z.object({
  status: z.enum(["success", "partial", "not_found", "connection_missing", "permission_missing", "error"]).default("success"),
  searchMetadata: z.object({
    query: z.string().optional(),
    sourceUsed: z.string().optional(),
    missingData: z.array(z.string()).optional(),
  }).optional(),
  summary: z.string().min(1).optional(),
  firmographics: z.object({
    industry: z.string().optional(),
    employeeCount: z.string().optional(),
    revenue: z.string().optional(),
    location: z.string().optional(),
  }).optional(),
  techStack: z.array(z.string()).default([]).optional(),
  hiringSignals: z.array(z.string()).default([]).optional(),
  recommendedAngle: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type SalesIntelligence = z.infer<typeof salesIntelligenceSchema>;
