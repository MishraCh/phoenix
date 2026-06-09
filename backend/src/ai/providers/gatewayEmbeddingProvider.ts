import { embedMany } from "ai";

import { env } from "../../config/env.js";
import { ApiError } from "../../utils/apiError.js";
import type { EmbeddingProvider } from "./embeddingProvider.js";

/**
 * Embedding provider that routes OpenAI embeddings through the AI Gateway.
 * Dimensions are pinned to preserve the existing Firestore vector index (1536).
 */
export class GatewayEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "gateway-openai";
  readonly modelName: string;
  readonly dimensions: number;

  constructor() {
    this.modelName = env.GATEWAY_EMBEDDING_MODEL;
    this.dimensions = env.OPENAI_EMBEDDING_DIMENSIONS ?? 1536;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!env.AI_GATEWAY_API_KEY) {
      throw new ApiError({
        code: "EMBEDDING_KEY_MISSING",
        message: "AI_GATEWAY_API_KEY is required for the Gateway embedding provider.",
        status: 500,
      });
    }

    const { embeddings } = await embedMany({
      model: this.modelName,
      values: texts,
      providerOptions: { openai: { dimensions: this.dimensions } },
    });

    return embeddings;
  }
}
