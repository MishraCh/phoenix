import type { CommandMode } from "../schemas/commandOutput.js";
import type { ExpertSelectedItem } from "../../experts/types.js";

const urlPattern = /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s<>"{}|\\^[\]`]+)?/gi;

function extractUrls(input: string) {
  return Array.from(input.matchAll(urlPattern)).map((m) => m[0]);
}

export function shouldSkipToolExecution(mode: CommandMode): boolean {
  return mode === "auto" || mode === "workflow";
}

export function toolNameForMode(mode: CommandMode): string | null {
  if (mode === "extract_url") return "web.extractUrl";
  if (mode === "search" || mode === "research") return "web.researchTask";
  return null;
}

export function buildClassifierUserPrompt(opts: {
  isFollowUp: boolean;
  agentName: string;
  input: string;
}): string {
  const lines: string[] = [];
  if (opts.isFollowUp) {
    lines.push(
      "Context: This is a follow-up turn in an ongoing conversation. You may still use search/research if the user's request clearly requires finding NEW external information from the web that wasn't covered in the previous turns.",
    );
  }
  lines.push(`Selected agent: ${opts.agentName}`);
  lines.push(`User command: ${opts.input}`);
  return lines.join("\n");
}

export function parseSlashMode(input: string): { mode: CommandMode | null; normalizedInput: string } {
  const match = input.match(/^\s*\/(search|research|extract|workflow)\b/i);

  if (!match) {
    return { mode: null, normalizedInput: input.trim() };
  }

  const raw = match[1]!.toLowerCase();
  const mode: CommandMode = raw === "extract" ? "extract_url" : (raw as CommandMode);
  return { mode, normalizedInput: input.slice(match[0].length).trim() };
}


export function parseSelectedExpertItem(contextSummary: string): ExpertSelectedItem | null {
  if (!contextSummary?.trim()) return null;

  try {
    const parsed = JSON.parse(contextSummary) as {
      payload?: {
        integration?: {
          provider?: "gmail" | "hubspot";
          selectedItem?: {
            itemId?: string;
            title?: string;
            itemType?: string;
            summary?: string;
          };
        };
      };
    };

    const integration = parsed.payload?.integration;
    const selectedItem = integration?.selectedItem;
    if (!integration?.provider || !selectedItem?.itemId || !selectedItem?.itemType) {
      return null;
    }

    return {
      provider: integration.provider,
      itemId: selectedItem.itemId,
      title: selectedItem.title ?? "Selected item",
      itemType: selectedItem.itemType,
      summary: selectedItem.summary,
    };
  } catch {
    return null;
  }
}
