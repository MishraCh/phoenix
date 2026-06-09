import { OpenAIEmbeddings } from "@langchain/openai";

import { logger } from "../observability/logger.js";

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly client: OpenAIEmbeddings;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "EmbeddingService: OPENAI_API_KEY is not set. " +
          "Set OPENAI_API_KEY to enable embedding-based retrieval.",
      );
    }

    const modelName = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-large";
    const dimensions = parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS ?? "1536", 10);

    this.client = new OpenAIEmbeddings({
      openAIApiKey: apiKey,
      modelName,
      dimensions,
    });
  }

  async embed(text: string): Promise<number[]> {
    return this.client.embedQuery(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.client.embedDocuments(texts);
  }
}

export class EmbeddingService {
  private readonly provider: EmbeddingProvider;

  constructor() {
    const providerName = process.env.EMBEDDING_PROVIDER ?? "openai";
    if (providerName === "openai") {
      this.provider = new OpenAIEmbeddingProvider();
    } else {
      throw new Error(
        `EmbeddingService: unknown provider "${providerName}". Supported: openai`,
      );
    }
  }

  embed(text: string): Promise<number[]> {
    return this.provider.embed(text);
  }

  embedBatch(texts: string[]): Promise<number[][]> {
    return this.provider.embedBatch(texts);
  }

  /**
   * Returns true only when the required environment variables are present.
   * Use this as a guard before constructing EmbeddingService.
   */
  static isConfigured(): boolean {
    const provider = process.env.EMBEDDING_PROVIDER ?? "openai";
    if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY);
    return false;
  }

  /**
   * Produces a concise text representation suitable for embedding.
   * Truncates to avoid excessive payload size before embedding generation.
   */
  static prepareText(title: string, body: string, maxBodyChars = 2000): string {
    const trimmedBody = body.slice(0, maxBodyChars);
    return `${title}\n\n${trimmedBody}`.trim();
  }
}

logger.debug("EmbeddingService module loaded", {
  provider: process.env.EMBEDDING_PROVIDER ?? "openai",
  configured: EmbeddingService.isConfigured(),
});
