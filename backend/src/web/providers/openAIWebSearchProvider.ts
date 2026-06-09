import type { Request } from "express";

import type { SourceRef } from "../../schemas/coreSchemas.js";
import { ExaSearchProvider } from "./exaSearchProvider.js";

export type OpenAIWebSearchInput = {
  query: string;
  depth?: "quick" | "deep";
  contextPacket?: import("../../schemas/toolTypes.js").ToolContextPacket;
  request?: Request;
};

export type OpenAIWebSearchResult = {
  content: string;
  sourceRefs: SourceRef[];
};

/**
 * Pure parser for OpenAI Responses-API web-search content blocks → text + citations.
 * Retained as a utility (no LangChain dependency); the live search path uses Exa.
 */
export function parseOpenAIWebSearchContent(content: unknown) {
  if (typeof content === "string") {
    return { text: content, citations: [] as Array<{ url: string; title?: string }> };
  }
  if (!Array.isArray(content)) {
    return { text: "", citations: [] as Array<{ url: string; title?: string }> };
  }

  const text: string[] = [];
  const citations: Array<{ url: string; title?: string }> = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    if (typeof block.text === "string") text.push(block.text);
    const annotations = Array.isArray(block.annotations) ? block.annotations : [];
    for (const annotation of annotations) {
      if (!annotation || typeof annotation !== "object") continue;
      const citation = annotation as Record<string, unknown>;
      if (
        (citation.type === "citation" || citation.type === "url_citation") &&
        typeof citation.url === "string"
      ) {
        citations.push({
          url: citation.url,
          ...(typeof citation.title === "string" ? { title: citation.title } : {}),
        });
      }
    }
  }
  return { text: text.join("\n\n").trim(), citations };
}

/**
 * Legacy "OpenAI web search" provider. The OpenAI web-search tool path was
 * retired in favor of Exa; this class is kept for compatibility (factory
 * selection + instanceof checks) and now delegates to Exa's grounded /answer.
 * No LangChain dependency.
 */
export class OpenAIWebSearchProvider {
  private readonly exa = new ExaSearchProvider();

  async search(input: OpenAIWebSearchInput): Promise<OpenAIWebSearchResult> {
    return this.exa.search(input);
  }
}
