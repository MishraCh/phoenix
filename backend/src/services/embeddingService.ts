import { embed, embedMany } from "ai";
import { openai } from "@ai-sdk/openai";

import { logger } from "../observability/logger.js";

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly modelName: string;
  private readonly dimensions: number;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        "EmbeddingService: OPENAI_API_KEY is not set. " +
          "Set OPENAI_API_KEY to enable embedding-based retrieval.",
      );
    }

    this.modelName = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-large";
    this.dimensions = parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS ?? "1536", 10);
  }

  private dimsOption() {
    return this.modelName.startsWith("text-embedding-3")
      ? { providerOptions: { openai: { dimensions: this.dimensions } } }
      : {};
  }

  async embed(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: openai.embedding(this.modelName),
      value: text,
      ...this.dimsOption(),
    });
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const { embeddings } = await embedMany({
      model: openai.embedding(this.modelName),
      values: texts,
      ...this.dimsOption(),
    });
    return embeddings;
  }
}

export class EmbeddingService {
  private readonly provider: EmbeddingProvider;

  constructor() {
    // Embeddings are OpenAI-backed under the hood regardless of LLM provider
    // selection (Anthropic offers no embeddings). Always use OpenAI here.
    this.provider = new OpenAIEmbeddingProvider();
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
    return Boolean(process.env.OPENAI_API_KEY);
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
