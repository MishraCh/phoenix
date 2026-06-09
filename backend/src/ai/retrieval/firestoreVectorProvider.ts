import { FieldValue, type Firestore } from "firebase-admin/firestore";

import type { VectorResult } from "../providers/embeddingProvider.js";

type VectorSearchFilter = {
  sourceType?: string;
};

export class FirestoreVectorProvider {
  constructor(private readonly db: Firestore) {}

  async similaritySearch(
    workspaceId: string,
    queryVector: number[],
    topK: number,
    filter?: VectorSearchFilter,
  ): Promise<VectorResult[]> {
    // Use collectionGroup to match the "Collection group" scoped vector index.
    // Workspace isolation is enforced by filtering workspaceId in the results below.
    const col = this.db.collectionGroup("embeddings");

    const vectorQuery = col.findNearest({
      vectorField: "vector",
      queryVector: FieldValue.vector(queryVector),
      limit: Math.min(topK * 2, 1000), // fetch extra when filtering post-query
      distanceMeasure: "COSINE",
      distanceResultField: "vectorDistance",
    });

    const snap = await vectorQuery.get();
    const results: VectorResult[] = [];

    for (const doc of snap.docs) {
      const data = doc.data();

      // Enforce workspace isolation — collectionGroup spans all workspaces
      if (data.workspaceId !== workspaceId) {
        continue;
      }

      if (filter?.sourceType && data.sourceType !== filter.sourceType) {
        continue;
      }

      const distance = typeof data.vectorDistance === "number" ? data.vectorDistance : undefined;

      results.push({
        sourceId: String(data.sourceId ?? ""),
        sourceType: String(data.sourceType ?? ""),
        workspaceId: String(data.workspaceId ?? workspaceId),
        chunkIndex: typeof data.chunkIndex === "number" ? data.chunkIndex : undefined,
        chunkText: typeof data.chunkText === "string" ? data.chunkText : undefined,
        // COSINE distance ∈ [0,2]; 0 = identical → score 1; 2 = opposite → score -1
        score: distance !== undefined ? 1 - distance : undefined,
      });

      if (results.length >= topK) {
        break;
      }
    }

    return results;
  }
}
