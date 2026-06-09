import type { SourceRef, Workspace } from "./coreSchemas.js";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type { SourceRef, Workspace };

export type ToolContextPacket = {
  sessionContext: string;
  workspaceContext: string;
  selectedItemContext: string;
  retrievedContext: string;
  sourceRefs: SourceRef[];
  semanticIntent?: string;
};
