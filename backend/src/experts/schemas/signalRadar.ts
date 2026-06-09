import { z } from "zod";

export const signalRadarSchema = z.object({
  status: z.enum(["ready", "missing_context", "partial", "not_found", "error"]).default("ready"),
  clarificationQuestion: z.string().optional(),
  missingFields: z.array(z.string()).optional(),
  searchMetadata: z.object({
    query: z.string().optional(),
    sourceUsed: z.string().optional(),
    missingData: z.array(z.string()).optional(),
  }).optional(),
  summary: z.string().optional(),
  urgency: z.enum(["low", "medium", "high", "critical"]).optional(),
  signals: z
    .array(
      z.object({
        title: z.string(),
        whyItMatters: z.string(),
        implication: z.string(),
      }),
    ).optional(),
  implications: z.array(z.string()).optional(),
  suggestedMoves: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type SignalRadar = z.infer<typeof signalRadarSchema>;

