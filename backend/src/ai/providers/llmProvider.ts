import type { ZodType } from "zod";
import type { AiBudgetScope } from "../execution/aiExecutionBudget.js";

export type StructuredGenerateInput<Output extends Record<string, unknown>> = {
  systemPrompt: string;
  userPrompt: string;
  schema: ZodType<Output>;
  maxOutputTokens?: number;
  budgetScope?: AiBudgetScope;
};

export interface LLMProvider {
  readonly providerName: string;
  readonly modelName: string;
  generateStructured<Output extends Record<string, unknown>>(
    input: StructuredGenerateInput<Output>,
  ): Promise<Output>;
}
