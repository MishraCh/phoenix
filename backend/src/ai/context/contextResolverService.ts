/**
 * ContextResolverService V1
 *
 * Resolves and budgets context blocks for prompt assembly per §7 of the
 * migration plan.
 *
 * Priority order (§7.2):
 *   1. active selected item context
 *   2. current user request
 *   3. current session summary
 *   4. top retrieved workspace context
 *   5. matched expert SOP/capability
 *   6. relevant integration summaries
 *   7. memory/preferences
 *   8. general model knowledge (handled by LLM; not in context blocks)
 *
 * Character budgets (§7.4):
 *   selected_item: 4000
 *   session_summary: 2000
 *   retrieved_context: 8000
 *   expert_sop: 3000
 *   memory/preferences: 2000
 *   tool_result: 5000
 */

export type ContextBlockType =
  | "selected_item"
  | "current_request"
  | "session_summary"
  | "retrieved_context"
  | "expert_sop"
  | "integration_summary"
  | "memory"
  | "preference"
  | "tool_result";

export type ContextBlock = {
  type: ContextBlockType;
  priority: number;
  content: string;
  sourceIds?: string[];
  freshness?: "fresh" | "stale" | "unknown";
  sourceKind?: "direct" | "retrieved" | "derived" | "tool_result";
  tokenBudget: number;
};

export type ContextResolverInput = {
  selectedItemContext?: string;
  sessionSummary?: string;
  retrievedContext?: string;
  expertSopText?: string;
  memoryContext?: string;
  toolResult?: string;
  userRequest: string;
};

export type ContextResolverOutput = {
  blocks: ContextBlock[];
  /** Assembled prompt string ready for injection */
  assembled: string;
  /** Per-block character counts for logging */
  sizes: Record<ContextBlockType, number>;
  /** Total assembled characters */
  totalChars: number;
};

// ---------------------------------------------------------------------------
// Token budgets (estimated at four characters per token).
// ---------------------------------------------------------------------------

const BUDGETS: Record<ContextBlockType, number> = {
  selected_item: 2500,
  current_request: 1000,
  session_summary: 6000,
  retrieved_context: 6000,
  expert_sop: 1500,
  integration_summary: 2000,
  memory: 1000,
  preference: 500,
  tool_result: 5000,
};

// ---------------------------------------------------------------------------
// Priority order (lower number = higher priority)
// ---------------------------------------------------------------------------

const PRIORITY: Record<ContextBlockType, number> = {
  selected_item: 1,
  tool_result: 2,
  current_request: 3,
  session_summary: 4,
  retrieved_context: 5,
  expert_sop: 6,
  integration_summary: 7,
  memory: 8,
  preference: 9,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeContent(content: string): string {
  const withoutMarkup = content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ");
  const seen = new Set<string>();
  return withoutMarkup
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n");
}

function clip(content: string, tokenBudget: number, skipNormalization: boolean = false): string {
  const processed = skipNormalization ? content.trim() : normalizeContent(content);
  const characterBudget = tokenBudget * 4;
  if (processed.length <= characterBudget) return processed;
  return processed.slice(0, characterBudget) + "\n[... context truncated to token budget ...]";
}

function buildBlock(
  type: ContextBlockType,
  content: string,
  extra?: Partial<ContextBlock>,
): ContextBlock {
  // Only normalize retrieved context (web search results) to avoid mangling formatted text
  const skipNormalization = type !== "retrieved_context";
  
  return {
    type,
    priority: PRIORITY[type],
    content: clip(content, BUDGETS[type], skipNormalization),
    tokenBudget: BUDGETS[type],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ContextResolverService {
  /**
   * Resolve context blocks from the available inputs.
   * Blocks are ordered by priority and clipped to budget.
   */
  resolve(input: ContextResolverInput): ContextResolverOutput {
    const blocks: ContextBlock[] = [];

    if (input.selectedItemContext?.trim()) {
      blocks.push(
        buildBlock("selected_item", input.selectedItemContext, {
          sourceKind: "direct",
          freshness: "fresh",
        }),
      );
    }

    if (input.toolResult?.trim()) {
      blocks.push(
        buildBlock("tool_result", input.toolResult, {
          sourceKind: "tool_result",
        }),
      );
    }

    if (input.expertSopText?.trim()) {
      blocks.push(
        buildBlock("expert_sop", input.expertSopText, {
          sourceKind: "retrieved",
        }),
      );
    }

    if (input.sessionSummary?.trim()) {
      blocks.push(
        buildBlock("session_summary", input.sessionSummary, {
          sourceKind: "derived",
        }),
      );
    }

    if (input.retrievedContext?.trim()) {
      blocks.push(
        buildBlock("retrieved_context", input.retrievedContext, {
          sourceKind: "retrieved",
        }),
      );
    }

    if (input.memoryContext?.trim()) {
      blocks.push(
        buildBlock("memory", input.memoryContext, {
          sourceKind: "retrieved",
        }),
      );
    }

    // Sort by priority (ascending = higher priority first)
    blocks.sort((a, b) => a.priority - b.priority);

    // Assemble prompt string
    const assembled = blocks
      .map((b) => {
        const label = b.type.replace(/_/g, " ").toUpperCase();
        return `[${label}]\n${b.content}`;
      })
      .join("\n\n");

    // Build size map
    const sizes = {} as Record<ContextBlockType, number>;
    for (const block of blocks) {
      sizes[block.type] = block.content.length;
    }

    return {
      blocks,
      assembled,
      sizes,
      totalChars: assembled.length,
    };
  }

  /**
   * Format a size summary for logging (§12 observability).
   */
  static formatSizeLog(sizes: Record<ContextBlockType, number>): string {
    return Object.entries(sizes)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
  }
}
