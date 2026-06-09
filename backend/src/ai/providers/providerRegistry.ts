import { env } from "../../config/env.js";
import { ApiError } from "../../utils/apiError.js";
import { OpenAILlmProvider } from "./openAILlmProvider.js";
import { OpenAIEmbeddingProvider } from "./openAIEmbeddingProvider.js";
import { GatewayLlmProvider } from "./gatewayLlmProvider.js";
import { GatewayEmbeddingProvider } from "./gatewayEmbeddingProvider.js";
import type { LLMProvider } from "./llmProvider.js";
import type { EmbeddingProvider } from "./embeddingProvider.js";

export type LlmRole = "fast" | "default" | "reasoning" | "research";

/** True when generation should route through the AI Gateway. */
function useGatewayForLlm(): boolean {
  if (env.LLM_PROVIDER === "gateway") return true;
  if (env.LLM_PROVIDER === "openai") return false;
  return Boolean(env.AI_GATEWAY_API_KEY); // "auto"
}

/** True when embeddings should route through the AI Gateway. */
function useGatewayForEmbeddings(): boolean {
  if (env.EMBEDDING_PROVIDER === "gateway") return true;
  if (env.EMBEDDING_PROVIDER === "openai") return false;
  return Boolean(env.AI_GATEWAY_API_KEY); // "auto"
}

function gatewayModelForRole(role: LlmRole): string {
  switch (role) {
    case "fast":
      return env.GATEWAY_FAST_MODEL;
    case "reasoning":
      return env.GATEWAY_REASONING_MODEL;
    case "research":
      return env.GATEWAY_RESEARCH_MODEL;
    case "default":
    default:
      return env.GATEWAY_DEFAULT_MODEL;
  }
}

function openAiModelForRole(role: LlmRole): string | undefined {
  switch (role) {
    case "fast":
      return env.OPENAI_FAST_MODEL;
    case "reasoning":
      return env.OPENAI_REASONING_MODEL;
    case "research":
      return env.OPENAI_RESEARCH_MODEL;
    case "default":
    default:
      return env.OPENAI_DEFAULT_MODEL;
  }
}

export function createLlmProvider(role: LlmRole = "default"): LLMProvider {
  if (useGatewayForLlm()) {
    return new GatewayLlmProvider(gatewayModelForRole(role), role);
  }
  return new OpenAILlmProvider(openAiModelForRole(role), role);
}

// Lightweight classifier provider — uses a smaller/faster model for mode classification.
export function createClassifierProvider(): LLMProvider {
  return createLlmProvider("fast");
}

export function createEmbeddingProvider(): EmbeddingProvider {
  if (useGatewayForEmbeddings()) {
    return new GatewayEmbeddingProvider();
  }
  if (env.EMBEDDING_PROVIDER === "openai" || env.EMBEDDING_PROVIDER === "auto") {
    return new OpenAIEmbeddingProvider();
  }
  throw new ApiError({
    code: "EMBEDDING_PROVIDER_UNSUPPORTED",
    message: `Embedding provider "${env.EMBEDDING_PROVIDER}" is not implemented. Set EMBEDDING_PROVIDER=auto|gateway|openai.`,
    status: 500,
  });
}
