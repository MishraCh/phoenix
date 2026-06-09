import { z } from "zod";

export const meetingSummarySchema = z.object({
  status: z.enum(["success", "partial", "not_found", "connection_missing", "permission_missing", "error"]).default("success"),
  searchMetadata: z.object({
    query: z.string().optional(),
    sourceUsed: z.string().optional(),
    missingData: z.array(z.string()).optional(),
  }).optional(),
  summary: z.string().min(1).optional(),
  attendees: z.array(z.string()).default([]).optional(),
  decisions: z.array(z.string()).default([]).optional(),
  actionItems: z.array(z.object({
    owner: z.string().optional(),
    task: z.string(),
    completed: z.boolean().default(false),
  })).default([]).optional(),
  followUpDraft: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type MeetingSummary = z.infer<typeof meetingSummarySchema>;
