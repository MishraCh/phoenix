import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";

import { env } from "../../config/env.js";
import { ApiError } from "../../utils/apiError.js";
import type { EmbeddingProvider } from "./embeddingProvider.js";

/**
 * Direct-OpenAI fallback embedding provider (used when the Gateway is not
 * selected). Uses the Vercel AI SDK's OpenAI provider — no LangChain dependency.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "openai";
  readonly modelName = env.OPENAI_EMBEDDING_MODEL;
  readonly dimensions = env.OPENAI_EMBEDDING_DIMENSIONS ?? 1536;

  async embed(texts: string[]): Promise<number[][]> {
    if (!env.OPENAI_API_KEY) {
      throw new ApiError({
        code: "EMBEDDING_KEY_MISSING",
        message: "OPENAI_API_KEY is not set. Add it to .env to enable embeddings.",
        status: 500,
      });
    }

    const { embeddings } = await embedMany({
      model: openai.embedding(this.modelName),
      values: texts,
      ...(this.modelName.startsWith("text-embedding-3")
        ? { providerOptions: { openai: { dimensions: this.dimensions } } }
        : {}),
    });

    return embeddings;
  }
}
