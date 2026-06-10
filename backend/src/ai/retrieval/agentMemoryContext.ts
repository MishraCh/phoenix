import type { Firestore } from "firebase-admin/firestore";

import { RetrievalService } from "./retrievalService.js";

/**
 * Tier-3 long-term memory for the agent: retrieve the most relevant workspace
 * memory/artifacts/indexed sources for the query and format them as a context
 * block the agent uses silently (so it never re-asks for established facts).
 *
 * Best-effort: returns "" on any failure — retrieval must never block a command.
 */
export async function buildAgentMemoryBlock(
  db: Firestore,
  workspaceId: string,
  query: string,
  topK = 5,
): Promise<string> {
  try {
    const results = await new RetrievalService(db).similaritySearch({ workspaceId, query, topK });
    const lines = results
      .map((r) => (typeof r.chunkText === "string" && r.chunkText.trim() ? `- ${r.chunkText.trim().slice(0, 400)}` : null))
      .filter((line): line is string => line !== null);

    if (lines.length === 0) return "";

    return `WORKSPACE MEMORY (relevant facts/preferences/prior work — use silently, do not re-ask the user for these):\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}
