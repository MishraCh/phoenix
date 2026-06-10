import { generateObject } from "ai";

import { env } from "../../config/env.js";
import { ApiError } from "../../utils/apiError.js";
import { sanitizeAiOutput } from "../../utils/aiOutputSanitizer.js";
import {
  estimateTokens,
  getAiExecutionContext,
} from "../execution/aiExecutionBudget.js";
import type { LLMProvider, StructuredGenerateInput } from "./llmProvider.js";

/**
 * LLM provider that routes structured generation through the Vercel AI Gateway.
 * A bare model string (e.g. "anthropic/claude-sonnet-4.5") is auto-routed to the
 * Gateway by the AI SDK when AI_GATEWAY_API_KEY is set.
 */
export class GatewayLlmProvider implements LLMProvider {
  readonly providerName = "gateway";
  readonly modelName: string;

  constructor(modelName: string, private readonly role = "default") {
    this.modelName = modelName;
  }

  async generateStructured<Output extends Record<string, unknown>>(
    input: StructuredGenerateInput<Output>,
  ): Promise<Output> {
    if (!env.AI_GATEWAY_API_KEY) {
      throw new ApiError({
        code: "LLM_CONFIG_MISSING",
        message: "AI_GATEWAY_API_KEY is required for the Gateway LLM provider.",
        status: 500,
      });
    }

    const execution = getAiExecutionContext();
    const estimatedInputTokens = estimateTokens(
      `${input.systemPrompt}\n${input.userPrompt}`,
    );
    const maxOutputTokens =
      execution?.budget.reserveCall(
        estimatedInputTokens,
        input.maxOutputTokens,
        input.budgetScope,
      ) ?? input.maxOutputTokens;
    const startedAt = performance.now();

    try {
      const { object, usage } = await generateObject({
        model: this.modelName,
        schema: input.schema,
        system: input.systemPrompt,
        prompt: input.userPrompt,
        // Our plan schemas use optionals/records that OpenAI's STRICT json_schema
        // rejects ('required'/'propertyNames' violations). The Gateway can route or
        // fall back to OpenAI even for anthropic/* models — keep strict mode off.
        providerOptions: { openai: { strictJsonSchema: false } },
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
        ...(execution ? { abortSignal: execution.signal } : {}),
      });

      const sanitizedResult = sanitizeAiOutput(object) as Output;
      const inputTokens = usage?.inputTokens ?? estimatedInputTokens;
      const outputTokens =
        usage?.outputTokens ?? estimateTokens(JSON.stringify(sanitizedResult));

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
