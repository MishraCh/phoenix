import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";

import { sanitizeAiOutput } from "../../utils/aiOutputSanitizer.js";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/apiError.js";
import {
  estimateTokens,
  getAiExecutionContext,
} from "../execution/aiExecutionBudget.js";
import type { LLMProvider, StructuredGenerateInput } from "./llmProvider.js";

/**
 * Direct-OpenAI fallback LLM provider (used when the Gateway is not selected).
 * Uses the Vercel AI SDK's OpenAI provider — no LangChain dependency.
 */
export class OpenAILlmProvider implements LLMProvider {
  readonly providerName = "openai";
  readonly modelName: string;

  constructor(modelName?: string, private readonly role = "default") {
    this.modelName = modelName ?? env.OPENAI_CHAT_MODEL ?? env.OPENAI_MODEL ?? "gpt-5.5";
  }

  async generateStructured<Output extends Record<string, unknown>>(
    input: StructuredGenerateInput<Output>,
  ): Promise<Output> {
    if (!env.OPENAI_API_KEY) {
      throw new ApiError({
        code: "LLM_CONFIG_MISSING",
        message: "OPENAI_API_KEY is required for OpenAI LLM provider.",
        status: 500,
      });
    }

    const execution = getAiExecutionContext();
    const estimatedInputTokens = estimateTokens(`${input.systemPrompt}\n${input.userPrompt}`);
    const maxOutputTokens =
      execution?.budget.reserveCall(estimatedInputTokens, input.maxOutputTokens, input.budgetScope) ??
      input.maxOutputTokens;
    const startedAt = performance.now();

    try {
      const { object, usage } = await generateObject({
        model: openai(this.modelName),
        schema: input.schema,
        system: input.systemPrompt,
        prompt: input.userPrompt,
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
        ...(execution ? { abortSignal: execution.signal } : {}),
      });

      const sanitizedResult = sanitizeAiOutput(object) as Output;
      const inputTokens = usage?.inputTokens ?? estimatedInputTokens;
      const outputTokens = usage?.outputTokens ?? estimateTokens(JSON.stringify(sanitizedResult));

      execution?.budget.recordGeneratedTokens(outputTokens, input.budgetScope);
      execution?.recordUsage({
        provider: this.providerName,
        model: this.modelName,
        role: this.role,
        inputTokens,
        outputTokens,
        latencyMs: Number((performance.now() - startedAt).toFixed(2)),
        success: true,
        estimated: !usage,
        scope: input.budgetScope ?? "execution",
      });
      return sanitizedResult;
    } catch (error) {
      execution?.recordUsage({
        provider: this.providerName,
        model: this.modelName,
        role: this.role,
        inputTokens: estimatedInputTokens,
        outputTokens: 0,
        latencyMs: Number((performance.now() - startedAt).toFixed(2)),
        success: false,
        errorCode: error instanceof Error ? error.name : "UNKNOWN",
        estimated: true,
        scope: input.budgetScope ?? "execution",
      });
      throw error;
    }
  }
}
