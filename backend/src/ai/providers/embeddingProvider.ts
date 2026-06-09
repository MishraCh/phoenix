export type VectorResult = {
  sourceId: string;
  sourceType: string;
  workspaceId: string;
  chunkIndex?: number;
  chunkText?: string;
  score?: number;
};

export interface EmbeddingProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
