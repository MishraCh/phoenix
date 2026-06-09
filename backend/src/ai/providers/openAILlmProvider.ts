import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { sanitizeAiOutput } from "../../utils/aiOutputSanitizer.js";

import { env } from "../../config/env.js";
import { ApiError } from "../../utils/apiError.js";
import {
  estimateTokens,
  getAiExecutionContext,
} from "../execution/aiExecutionBudget.js";
import type { LLMProvider, StructuredGenerateInput } from "./llmProvider.js";

export class OpenAILlmProvider implements LLMProvider {
  readonly providerName = "openai";
  readonly modelName: string;

  constructor(modelName?: string, private readonly role = "default") {
    this.modelName = modelName ?? env.OPENAI_CHAT_MODEL ?? env.OPENAI_MODEL ?? "gpt-5.5";
  }

  private getModel(maxTokens?: number) {
    if (!env.OPENAI_API_KEY) {
      throw new ApiError({
        code: "LLM_CONFIG_MISSING",
        message: "OPENAI_API_KEY is required for OpenAI LLM provider.",
        status: 500,
      });
    }

    return new ChatOpenAI({
      apiKey: env.OPENAI_API_KEY,
      modelName: this.modelName,
      ...(maxTokens ? { maxTokens } : {}),
      timeout: 60_000,
    });
  }

  async generateStructured<Output extends Record<string, unknown>>(
    input: StructuredGenerateInput<Output>,
  ) {
    const execution = getAiExecutionContext();
    const estimatedInputTokens = estimateTokens(`${input.systemPrompt}\n${input.userPrompt}`);
    const maxOutputTokens = execution?.budget.reserveCall(
      estimatedInputTokens,
      input.maxOutputTokens,
      input.budgetScope,
    ) ?? input.maxOutputTokens;
    const startedAt = performance.now();
    const model = this.getModel(maxOutputTokens).withStructuredOutput(input.schema, {
      name: "respond",
      method: "functionCalling",
    });

    try {
      const result = await model.invoke(
        [
          new SystemMessage(input.systemPrompt),
          new HumanMessage(input.userPrompt),
        ],
        execution ? { signal: execution.signal } : undefined,
      ) as Output | undefined;

      if (!result) {
        throw new Error("LLM failed to return structured output (returned undefined).");
      }

      const sanitizedResult = sanitizeAiOutput(result);

      const estimatedOutputTokens = estimateTokens(JSON.stringify(sanitizedResult));
      execution?.budget.recordGeneratedTokens(
        estimatedOutputTokens,
        input.budgetScope,
      );
      execution?.recordUsage({
        provider: this.providerName,
        model: this.modelName,
        role: this.role,
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens,
        latencyMs: Number((performance.now() - startedAt).toFixed(2)),
        success: true,
        estimated: true,
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
