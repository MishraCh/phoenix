import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

import { createEmbeddingProvider } from "../providers/providerRegistry.js";
import type { EmbeddingProvider } from "../providers/embeddingProvider.js";
import { embeddingRecordSchema, type EmbeddingRecord } from "../../schemas/coreSchemas.js";
import { ApiError } from "../../utils/apiError.js";
import { logger } from "../../observability/logger.js";

type EmbedDocumentInput = {
  workspaceId: string;
  sourceType: EmbeddingRecord["sourceType"];
  sourceId: string;
  sourceHash: string;
  text: string;
  chunkIndex?: number;
  chunkText?: string;
};

function isKeyMissingError(err: unknown): boolean {
  return err instanceof ApiError && err.code === "EMBEDDING_KEY_MISSING";
}

function collection(db: Firestore, workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("embeddings");
}

export class EmbeddingService {
  private readonly provider: EmbeddingProvider;

  constructor(private readonly db: Firestore) {
    this.provider = createEmbeddingProvider();
  }

  /**
   * Embeds a document and stores it in Firestore. Returns null (no throw) if
   * OPENAI_API_KEY is not yet set — callers can proceed without embeddings.
   * Returns the existing record if sourceHash is unchanged (staleness check).
   */
  async embedDocument(input: EmbedDocumentInput): Promise<EmbeddingRecord | null> {
    const existing = await this.findBySourceHash(
      input.workspaceId,
      input.sourceId,
      input.sourceHash,
    );
    if (existing) {
      return existing;
    }

    let vectors: number[][];
    try {
      vectors = await this.provider.embed([input.text]);
    } catch (err) {
      if (isKeyMissingError(err)) {
        logger.warn("Skipping embedding: OPENAI_API_KEY not set", {
          sourceId: input.sourceId,
          sourceType: input.sourceType,
        });
        return null;
      }
      throw err;
    }

    const vector = vectors[0];
    if (!vector || vector.length === 0) {
      throw new Error(`Embedding returned empty vector for sourceId=${input.sourceId}`);
    }

    const docRef = collection(this.db, input.workspaceId).doc();
    const now = Timestamp.now();

    const record: EmbeddingRecord = {
      id: docRef.id,
      workspaceId: input.workspaceId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceHash: input.sourceHash,
      embeddingProvider: this.provider.providerName,
      embeddingModel: this.provider.modelName,
      dimensions: this.provider.dimensions,
      vector,
      ...(input.chunkIndex !== undefined ? { chunkIndex: input.chunkIndex } : {}),
      ...(input.chunkText !== undefined ? { chunkText: input.chunkText } : {}),
      createdAt: now,
      updatedAt: now,
    };

    // Store vector as Firestore VectorValue for findNearest queries
    await docRef.set({
      ...record,
      vector: FieldValue.vector(vector),
    });

    return record;
  }

  /**
   * Embeds a query string for similarity search. Returns null (no throw) if
   * OPENAI_API_KEY is not set.
   */
  async embedQuery(text: string): Promise<number[] | null> {
    try {
      const vectors = await this.provider.embed([text]);
      return vectors[0] ?? null;
    } catch (err) {
      if (isKeyMissingError(err)) {
        logger.warn("Skipping query embedding: OPENAI_API_KEY not set");
        return null;
      }
      throw err;
    }
  }

  async deleteBySources(
    workspaceId: string,
    sourceType: EmbeddingRecord["sourceType"],
    sourceIds: string[],
  ): Promise<number> {
    if (sourceIds.length === 0) {
      return 0;
    }

    let deleted = 0;

    for (const sourceId of sourceIds) {
      const snap = await collection(this.db, workspaceId)
        .where("sourceType", "==", sourceType)
        .where("sourceId", "==", sourceId)
        .limit(100)
        .get();

      if (snap.empty) {
        continue;
      }

      const batch = this.db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      deleted += snap.size;
    }

    return deleted;
  }

  private async findBySourceHash(
    workspaceId: string,
    sourceId: string,
    sourceHash: string,
  ): Promise<EmbeddingRecord | null> {
    const snap = await collection(this.db, workspaceId)
      .where("sourceId", "==", sourceId)
      .where("sourceHash", "==", sourceHash)
      .limit(1)
      .get();

    if (snap.empty) {
      return null;
    }

    const doc = snap.docs[0];
    const data = doc.data();

    // VectorValue from Firestore needs to be converted back to number[]
    const rawVector = data.vector;
    const vector: number[] =
      rawVector && typeof rawVector === "object" && "toArray" in rawVector
        ? (rawVector as { toArray(): number[] }).toArray()
        : Array.isArray(rawVector)
          ? (rawVector as number[])
          : [];

    return embeddingRecordSchema.parse({ ...data, id: doc.id, vector });
  }
}
