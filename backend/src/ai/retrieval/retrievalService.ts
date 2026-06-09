import type { Firestore } from "firebase-admin/firestore";

import { EmbeddingService } from "../embeddings/embeddingService.js";
import { FirestoreVectorProvider } from "./firestoreVectorProvider.js";
import type { EmbeddingRecord } from "../../schemas/coreSchemas.js";
import type { VectorResult } from "../providers/embeddingProvider.js";
import { logger } from "../../observability/logger.js";

type SimilaritySearchInput = {
  workspaceId: string;
  query: string;
  topK?: number;
  filter?: { sourceType?: string };
};

type IndexDocumentInput = {
  workspaceId: string;
  sourceType: EmbeddingRecord["sourceType"];
  sourceId: string;
  sourceHash: string;
  text: string;
  chunkIndex?: number;
  chunkText?: string;
};

export class RetrievalService {
  private readonly embeddingService: EmbeddingService;
  private readonly vectorProvider: FirestoreVectorProvider;

  constructor(private readonly db: Firestore) {
    this.embeddingService = new EmbeddingService(db);
    this.vectorProvider = new FirestoreVectorProvider(db);
  }

  /**
   * Embeds the query and searches Firestore for similar documents.
   * Returns [] gracefully when OPENAI_API_KEY is not yet configured.
   */
  async similaritySearch(input: SimilaritySearchInput): Promise<VectorResult[]> {
    const { workspaceId, query, topK = 10, filter } = input;

    const queryVector = await this.embeddingService.embedQuery(query);
    if (!queryVector) {
      return [];
    }

    try {
      return await this.vectorProvider.similaritySearch(workspaceId, queryVector, topK, filter);
    } catch (err) {
      logger.warn("Vector search failed; returning empty results", {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Embeds and indexes a document. Returns null (no throw) when OPENAI_API_KEY
   * is not set — callers should treat null as "not indexed yet".
   * Skips re-embedding when sourceHash is unchanged.
   */
  async indexDocument(input: IndexDocumentInput): Promise<EmbeddingRecord | null> {
    return this.embeddingService.embedDocument(input);
  }
}
