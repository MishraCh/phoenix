import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";

import { createLlmProvider } from "../ai/providers/providerRegistry.js";
import { ApprovalService } from "../approvals/approvalService.js";
import { MemoryService } from "./memoryService.js";
import { logger } from "../observability/logger.js";
import type { Workspace } from "../schemas/coreSchemas.js";

export class ApprovalMemoryExtractionService {
  constructor(private readonly db: Firestore) {}

  async processEditedApproval(workspaceId: string, approvalId: string) {
    try {
      const workspaceSnapshot = await this.db.collection("workspaces").doc(workspaceId).get();
      if (!workspaceSnapshot.exists) return;
      const workspace = { id: workspaceSnapshot.id, ...workspaceSnapshot.data() } as Workspace;

      const approvalService = new ApprovalService(this.db);
      const approval = await approvalService.getApproval(workspace, approvalId);

      if (approval.type !== "email_send" || !approval.wasEdited) {
        return;
      }

      const originalBody = approval.preview?.body as string | undefined;
      const editedBody = approval.proposedAction.input?.body as string | undefined;

      if (!originalBody || !editedBody || originalBody === editedBody) {
        return;
      }

      logger.info("Extracting memory from edited email approval", { workspaceId, approvalId });

      const llm = createLlmProvider("fast");

      const schema = z.object({
        facts: z.array(z.string()).describe("Any new hard facts, names, or statements the user manually added that were not in the original draft."),
        preferences: z.array(z.string()).describe("Writing style preferences or rules inferred from how the user changed the draft (e.g. 'Prefers shorter greetings', 'Uses more casual sign-offs').")
      });

      const systemPrompt = `You are an AI Chief of Staff memory extractor. 
Your job is to compare an AI-generated email draft with the user's final edited version before it was sent.
Extract two things:
1. Hard facts or context the user added (e.g., specific names, dates, pricing, or product details).
2. Writing style preferences inferred from the edits (e.g., removing jargon, changing the greeting, shortening paragraphs).

Only extract meaningful patterns. If the change was just a minor typo fix, return empty arrays.`;

      const userPrompt = `ORIGINAL AI DRAFT:
${originalBody}

USER'S EDITED FINAL VERSION:
${editedBody}`;

      const result = await llm.generateStructured({
        schema,
        systemPrompt,
        userPrompt,
      });

      const memoryService = new MemoryService(this.db);

      for (const fact of result.facts) {
        if (fact.trim().length > 5) {
          await memoryService.createFromPromotion(workspaceId, {
            type: "fact",
            content: fact,
            source: "user",
            sourceId: `approval_${approvalId}`,
            confidence: 0.9,
          });
        }
      }

      for (const pref of result.preferences) {
        if (pref.trim().length > 5) {
          await memoryService.createFromPromotion(workspaceId, {
            type: "preference",
            content: pref,
            source: "user",
            sourceId: `approval_${approvalId}`,
            confidence: 0.9,
          });
        }
      }

      logger.info("Successfully extracted memory from approval", { 
        workspaceId, 
        approvalId, 
        factsCount: result.facts.length, 
        preferencesCount: result.preferences.length 
      });

    } catch (error) {
      logger.error("Failed to process memory extraction for approval", {
        workspaceId,
        approvalId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
