/**
 * Decides which execution engine handles a command:
 *  - the autonomous Vercel AI SDK ToolLoopAgent (multi-step), or
 *  - the deterministic single-pass command pipeline (the former LangGraph path).
 *
 * Pure + dependency-free so it is exhaustively testable.
 */
export type CommandMode = "auto" | "search" | "research" | "extract_url" | "workflow";

/**
 * The agent handles conversational/agentic intents (auto, research, and the
 * default/unspecified mode). Dedicated single-purpose modes (search, extract_url,
 * workflow) stay on the deterministic pipeline for predictable, scoped output.
 * When the feature flag is off, everything uses the deterministic pipeline.
 */
export function shouldUseToolLoop(
  mode: CommandMode | string | undefined,
  agenticEnabled: boolean,
): boolean {
  if (!agenticEnabled) return false;
  return mode === "auto" || mode === "research" || mode === undefined;
}
