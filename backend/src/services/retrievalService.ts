import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { logger } from "../observability/logger.js";
import { EmbeddingService } from "./embeddingService.js";
import { EmbeddingIndexService } from "../ai/indexing/embeddingIndexService.js";
import type { IndexedSourceType } from "../schemas/coreSchemas.js";

export type RetrievalSource = "artifact" | "session_summary" | "memory_node" | "context_bundle";

export type RetrievalResult = {
  source: RetrievalSource;
  id: string;
  title: string;
  content: string;
  relevanceScore: number;
};

export type RetrievalOptions = {
  topK?: number;
  collections?: Array<"artifacts" | "session_summaries" | "memory" | "bundles">;
  userId?: string;
  userRole?: string;
  useIndexedSources?: boolean;
  sourceTypes?: IndexedSourceType[];
};

const DISTANCE_RESULT_FIELD = "vectorDistance";

function cosineDistanceToScore(distance: number): number {
  return 1 - Math.min(Math.max(distance, 0), 2) / 2;
}

export class RetrievalService {
  constructor(private readonly db: Firestore) {}

  async retrieve(
    workspaceId: string,
    query: string,
    options: RetrievalOptions = {},
  ): Promise<RetrievalResult[]> {
    if (!EmbeddingService.isConfigured()) {
      logger.debug("retrieval skipped: embedding provider not configured", { workspaceId });
      return [];
    }

    const { topK = 6, collections = ["artifacts"] } = options;

    try {
      if (options.useIndexedSources) {
        const indexed = await new EmbeddingIndexService(this.db).search({
          workspaceId,
          userId: options.userId,
          userRole: options.userRole,
          query,
          topK,
          sourceTypes: options.sourceTypes,
        });
        return indexed.map(({ source, score }) => ({
          source:
            source.sourceType === "artifact"
              ? "artifact"
              : source.sourceType === "session_summary"
                ? "session_summary"
                : source.sourceType === "memory_fact"
                  ? "memory_node"
                  : "context_bundle",
          id: source.sourceId,
          title: source.title,
          content: source.contentChunk,
          relevanceScore: score,
        }));
      }

      const embeddingService = new EmbeddingService();
      const queryEmbedding = await embeddingService.embed(query);

      const resultBatches = await Promise.all([
        collections.includes("artifacts")
          ? this.retrieveArtifacts(workspaceId, queryEmbedding, topK)
          : Promise.resolve([]),
        collections.includes("session_summaries")
          ? this.retrieveSessionSummaries(workspaceId, queryEmbedding, topK)
          : Promise.resolve([]),
        collections.includes("memory")
          ? this.retrieveMemory(workspaceId, queryEmbedding, topK)
          : Promise.resolve([]),
      ]);

      const merged = resultBatches.flat();
      return merged
        .filter((r) => r.relevanceScore > 0.3)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, topK);
    } catch (err) {
      logger.warn("retrieval failed — returning empty results", {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  async indexArtifact(workspaceId: string, artifactId: string, title: string, content: string): Promise<void> {
    if (!EmbeddingService.isConfigured()) return;
    try {
      const text = EmbeddingService.prepareText(title, content);
      const service = new EmbeddingService();
      const embedding = await service.embed(text);
      await this.db
        .collection("workspaces")
        .doc(workspaceId)
        .collection("artifacts")
        .doc(artifactId)
        .update({ embedding: FieldValue.vector(embedding) });
    } catch (err) {
      logger.warn("artifact embedding failed", {
        workspaceId,
        artifactId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async indexSessionSummary(
    workspaceId: string,
    sessionId: string,
    title: string,
    summary: string,
  ): Promise<void> {
    if (!EmbeddingService.isConfigured()) return;
    try {
      const text = EmbeddingService.prepareText(title, summary);
      const service = new EmbeddingService();
      const embedding = await service.embed(text);
      await this.db
        .collection("workspaces")
        .doc(workspaceId)
        .collection("commandSessions")
        .doc(sessionId)
        .update({ embedding: FieldValue.vector(embedding) });
    } catch (err) {
      logger.warn("session summary embedding failed", {
        workspaceId,
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async indexMemoryNode(
    workspaceId: string,
    memoryId: string,
    content: string,
  ): Promise<void> {
    if (!EmbeddingService.isConfigured()) return;
    try {
      const service = new EmbeddingService();
      const embedding = await service.embed(content);
      await this.db
        .collection("workspaces")
        .doc(workspaceId)
        .collection("memory")
        .doc(memoryId)
        .update({ embedding: FieldValue.vector(embedding) });
    } catch (err) {
      logger.warn("memory node embedding failed", {
        workspaceId,
        memoryId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async retrieveArtifacts(
    workspaceId: string,
    queryEmbedding: number[],
    topK: number,
  ): Promise<RetrievalResult[]> {
    try {
      const ref = this.db.collection("workspaces").doc(workspaceId).collection("artifacts");
      const snapshot = await ref
        .findNearest({
          vectorField: "embedding",
          queryVector: FieldValue.vector(queryEmbedding),
          limit: topK,
          distanceMeasure: "COSINE",
          distanceResultField: DISTANCE_RESULT_FIELD,
        })
        .get();
      return snapshot.docs.map((doc) => {
        const data = doc.data();
        const distance = typeof doc.get(DISTANCE_RESULT_FIELD) === "number"
          ? (doc.get(DISTANCE_RESULT_FIELD) as number)
          : 1;
        return {
          source: "artifact" as const,
          id: doc.id,
          title: String(data["title"] ?? "Untitled artifact"),
          content: String(data["textContent"] ?? "").slice(0, 4000),
          relevanceScore: cosineDistanceToScore(distance),
        };
      });
    } catch (err) {
      logger.debug("artifact vector search unavailable", {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private async retrieveSessionSummaries(
    workspaceId: string,
    queryEmbedding: number[],
    topK: number,
  ): Promise<RetrievalResult[]> {
    try {
      const ref = this.db.collection("workspaces").doc(workspaceId).collection("commandSessions");
      const snapshot = await ref
        .findNearest({
          vectorField: "embedding",
          queryVector: FieldValue.vector(queryEmbedding),
          limit: topK,
          distanceMeasure: "COSINE",
          distanceResultField: DISTANCE_RESULT_FIELD,
        })
        .get();
      return snapshot.docs.map((doc) => {
        const data = doc.data();
        const distance = typeof doc.get(DISTANCE_RESULT_FIELD) === "number"
          ? (doc.get(DISTANCE_RESULT_FIELD) as number)
          : 1;
        return {
          source: "session_summary" as const,
          id: doc.id,
          title: String(data["title"] ?? "Session"),
          content: String(data["summary"] ?? data["lastMessagePreview"] ?? "").slice(0, 4000),
          relevanceScore: cosineDistanceToScore(distance),
        };
      });
    } catch (err) {
      logger.debug("session summary vector search unavailable", {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private async retrieveMemory(
    workspaceId: string,
    queryEmbedding: number[],
    topK: number,
  ): Promise<RetrievalResult[]> {
    try {
      const ref = this.db.collection("workspaces").doc(workspaceId).collection("memory");
      const snapshot = await ref
        .findNearest({
          vectorField: "embedding",
          queryVector: FieldValue.vector(queryEmbedding),
          limit: topK,
          distanceMeasure: "COSINE",
          distanceResultField: DISTANCE_RESULT_FIELD,
        })
        .get();
      return snapshot.docs
        .filter((doc) => doc.data()["status"] === "active")
        .map((doc) => {
          const data = doc.data();
          const distance = typeof doc.get(DISTANCE_RESULT_FIELD) === "number"
            ? (doc.get(DISTANCE_RESULT_FIELD) as number)
            : 1;
          return {
            source: "memory_node" as const,
            id: doc.id,
            title: `Memory (${String(data["type"] ?? "fact")})`,
            content: String(data["content"] ?? "").slice(0, 4000),
            relevanceScore: cosineDistanceToScore(distance),
          };
        });
    } catch {
      // Vector index not ready — fall back to plain active memory list
      return this.retrieveMemoryFallback(workspaceId, topK);
    }
  }

  private async retrieveMemoryFallback(workspaceId: string, topK: number): Promise<RetrievalResult[]> {
    try {
      const ref = this.db.collection("workspaces").doc(workspaceId).collection("memory");
      const snapshot = await ref
        .where("status", "==", "active")
        .orderBy("createdAt", "desc")
        .limit(topK)
        .get();
      return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          source: "memory_node" as const,
          id: doc.id,
          title: `Memory (${String(data["type"] ?? "fact")})`,
          content: String(data["content"] ?? "").slice(0, 4000),
          relevanceScore: 0.6,
        };
      });
    } catch (err) {
      logger.debug("memory fallback retrieval failed", {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  static formatForPrompt(results: RetrievalResult[], maxTotalChars: number = 6000): string {
    if (results.length === 0) return "";
    
    let currentTotal = 0;
    const formattedBlocks: string[] = [];

    for (const r of results) {
      const sourceLabel = r.source === "artifact" ? "Document Artifact" 
                        : r.source === "session_summary" ? "Past Conversation Summary"
                        : "Memory Fact";
      
      const header = `[${sourceLabel}] (Relevance: ${r.relevanceScore.toFixed(2)})\nTitle: ${r.title}\nContent:\n`;
      const availableChars = Math.max(0, maxTotalChars - currentTotal - header.length);
      
      if (availableChars < 100 && formattedBlocks.length > 0) {
        // Stop if we don't have enough room for meaningful content
        break;
      }

      let contentToAdd = r.content;
      if (contentToAdd.length > availableChars) {
        contentToAdd = contentToAdd.slice(0, availableChars) + "... (truncated)";
      }

      const block = `${header}${contentToAdd}`;
      formattedBlocks.push(block);
      currentTotal += block.length + 2; // +2 for newline joining
    }

    return `Retrieved workspace context:\n${formattedBlocks.join("\n\n")}`;
  }
}
