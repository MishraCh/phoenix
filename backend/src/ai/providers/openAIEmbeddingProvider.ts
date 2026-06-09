import { OpenAIEmbeddings } from "@langchain/openai";

import { env } from "../../config/env.js";
import { ApiError } from "../../utils/apiError.js";
import type { EmbeddingProvider } from "./embeddingProvider.js";

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

    const embedder = new OpenAIEmbeddings({
      apiKey: env.OPENAI_API_KEY,
      model: this.modelName,
      ...(this.modelName.startsWith("text-embedding-3") ? { dimensions: this.dimensions } : {}),
    });

    return embedder.embedDocuments(texts);
  }
}
