export type EvalCategory =
  | "product-awareness"
  | "integration-awareness"
  | "workflow-awareness"
  | "agent-behavior"
  | "session-continuity"
  | "memory-retrieval"
  | "safety-approval";

export type EvalCase = {
  id: string;
  name: string;
  category: EvalCategory;
  input: string;
  selectedAgentId?: string;
  mode?: string;
  sessionContext?: string;
  expectedRouting?: string;
  requiredSignals: string[];
  prohibitedClaims: string[];
  notes?: string;
};

export type EvalResult = {
  caseId: string;
  caseName: string;
  category: EvalCategory;
  pass: boolean;
  resolvedMode: string;
  resultType: string;
  answerExcerpt: string;
  missingSignals: string[];
  foundProhibited: string[];
  durationMs: number;
  error?: string;
};

export type EvalReport = {
  runAt: string;
  workspaceId: string;
  workspaceName: string;
  totalCases: number;
  passed: number;
  failed: number;
  errored: number;
  durationMs: number;
  byCategory: Partial<Record<EvalCategory, { total: number; passed: number }>>;
  results: EvalResult[];
};
