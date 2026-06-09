import { z } from "zod";
import { createLlmProvider } from "../providers/providerRegistry.js";
import { logger } from "../../observability/logger.js";

const claimSafetySchema = z.object({
  isSafe: z.boolean().describe("True if the text contains NO hallucinated claims. False if it contains fabricated pricing, deadlines, facts, or assumptions not present in the context."),
  reasoning: z.string().describe("Explanation for why the text is safe or unsafe."),
  violatingClaims: z.array(z.string()).describe("List of specific claims that appear fabricated, if any."),
});

export class ClaimSafetyService {
  /**
   * Verifies that the proposed draft or note does not invent unsupported claims
   * (e.g. pricing, deadlines, features, competitor attacks) that are not present in the workspace context.
   */
  async verifyDraftSafety(draftText: string, contextSummary: string): Promise<{ isSafe: boolean; reasoning: string; violatingClaims: string[] }> {
    if (!draftText || draftText.trim().length === 0) {
      return { isSafe: true, reasoning: "Empty draft", violatingClaims: [] };
    }

    try {
      const llm = createLlmProvider("fast"); // Fast lane uses the lower-latency configured chat model
      
      const systemPrompt = `You are a safety and compliance guardrail for an AI Chief of Staff.
Your job is to verify that the proposed draft (an email or CRM note) does NOT contain hallucinated or fabricated claims.
A fabricated claim is:
1. Specific pricing, discounts, or costs not explicitly stated in the context.
2. Hard deadlines, dates, or meeting times that were not provided.
3. Unsupported features, capabilities, or competitor attacks.
4. Bold assumptions about the user's business that are not in the context.

If the draft is generic, standard professional communication (e.g., "Looking forward to speaking", "Thanks for your time"), it is SAFE.
If the draft relies ONLY on facts provided in the "Provided Context", it is SAFE.
If the draft invents specific numbers, commitments, or facts NOT in the context, it is UNSAFE.`;

      const userPrompt = `=== PROVIDED CONTEXT ===\n${contextSummary}\n\n=== PROPOSED DRAFT ===\n${draftText}`;

      const result = await llm.generateStructured({
        schema: claimSafetySchema,
        systemPrompt,
        userPrompt,
      });

      if (!result.isSafe) {
        logger.warn("ClaimSafetyService: Draft flagged as unsafe", { 
          violatingClaims: result.violatingClaims,
          reasoning: result.reasoning
        });
      }

      return result;
    } catch (err) {
      logger.error("ClaimSafetyService failed", { error: err });
      // Fail-open for MVP, but log the error
      return { isSafe: true, reasoning: "Fallback due to safety service error", violatingClaims: [] };
    }
  }
}
