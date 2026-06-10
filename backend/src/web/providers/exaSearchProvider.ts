import type { Request } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { Exa } from "exa-js";

import { env } from "../../config/env.js";
import { logger } from "../../observability/logger.js";
import { sourceRefSchema, type SourceRef } from "../../schemas/coreSchemas.js";
import { ApiError } from "../../utils/apiError.js";

export type ExaSearchInput = {
  query: string;
  depth?: "quick" | "deep";
  contextPacket?: import("../../schemas/toolTypes.js").ToolContextPacket;
  request?: Request;
};

export type ExaSearchResult = {
  content: string;
  sourceRefs: SourceRef[];
};

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Build a web SourceRef, returning null for malformed URLs (Exa occasionally
 *  returns non-URL citation strings — one bad citation must not fail the search). */
function toWebSourceRef(url: unknown, title: unknown, providerName: string): SourceRef | null {
  if (typeof url !== "string") return null;
  try {
    return sourceRefSchema.parse({
      sourceType: "web",
      sourceId: hashValue(`${providerName}:${url}`),
      title: typeof title === "string" && title ? title : "Web result",
      url,
      fetchedAt: Timestamp.now(),
      provider: providerName,
    });
  } catch {
    return null;
  }
}

/**
 * Web search provider backed by Exa's grounded /answer endpoint.
 * Returns a synthesized, citation-backed answer plus web SourceRefs — a
 * drop-in match for OpenAIWebSearchProvider's { content, sourceRefs } contract.
 */
export class ExaSearchProvider {
  async search(input: ExaSearchInput): Promise<ExaSearchResult> {
    if (!env.EXA_API_KEY) {
      throw new ApiError({
        code: "WEB_PROVIDER_CONFIG_MISSING",
        message: "EXA_API_KEY is required for the Exa search provider.",
        status: 500,
      });
    }

    const exa = new Exa(env.EXA_API_KEY);
    const startedAt = performance.now();

    try {
      const response = (await exa.answer(input.query, { text: true })) as unknown as {
        answer?: string;
        citations?: Array<{ url?: string; title?: string }>;
      };
      const answer = typeof response.answer === "string" ? response.answer.trim() : "";
      if (!answer) {
        throw new Error("Exa returned an empty answer.");
      }

      const citations = Array.isArray(response.citations) ? response.citations : [];
      const uniqueCitations = citations.filter(
        (citation, index, all) =>
          typeof citation?.url === "string" &&
          all.findIndex((candidate) => candidate?.url === citation.url) === index,
      );

      logger.info("Exa search completed", {
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        citationCount: uniqueCitations.length,
      });

      return {
        content: answer,
        sourceRefs: uniqueCitations
          .map((citation) => toWebSourceRef(citation.url, citation.title, "exa_search"))
          .filter((ref): ref is SourceRef => ref !== null),
      };
    } catch (error) {
      logger.warn("Exa search failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ApiError({
        code: "WEB_PROVIDER_REQUEST_FAILED",
        message: `Failed to search web via Exa: ${input.query}`,
        status: 502,
        details: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  /**
   * Raw entity search (for dataset building): returns up to `numResults` results
   * with title/url/text. Used by the search+enrich dataset fallback.
   */
  async searchEntities(query: string, numResults = 10): Promise<Array<{ name: string; url: string; text: string }>> {
    if (!env.EXA_API_KEY) {
      throw new ApiError({
        code: "WEB_PROVIDER_CONFIG_MISSING",
        message: "EXA_API_KEY is required for Exa entity search.",
        status: 500,
      });
    }
    const exa = new Exa(env.EXA_API_KEY);
    const response = (await exa.searchAndContents(query, {
      numResults,
      text: { maxCharacters: 1500 },
    })) as unknown as { results?: Array<{ title?: string; url?: string; text?: string }> };

    const results = Array.isArray(response.results) ? response.results : [];
    return results
      .filter((result): result is { title?: string; url: string; text?: string } => typeof result.url === "string")
      .map((result) => ({
        name: result.title ?? result.url,
        url: result.url,
        text: typeof result.text === "string" ? result.text : "",
      }));
  }

  /**
   * Find sources similar to a given URL (related-source discovery / enrichment).
   * Returns web SourceRefs; excludes the source domain so results are genuinely related.
   */
  async findSimilar(url: string, numResults = 8): Promise<SourceRef[]> {
    if (!env.EXA_API_KEY) {
      throw new ApiError({
        code: "WEB_PROVIDER_CONFIG_MISSING",
        message: "EXA_API_KEY is required for Exa find-similar.",
        status: 500,
      });
    }

    const exa = new Exa(env.EXA_API_KEY);
    try {
      const response = (await exa.findSimilarAndContents(url, {
        numResults,
        excludeSourceDomain: true,
        text: { maxCharacters: 800 },
      })) as unknown as { results?: Array<{ url?: string; title?: string }> };

      const results = Array.isArray(response.results) ? response.results : [];
      return results
        .map((result) => toWebSourceRef(result.url, result.title, "exa_find_similar"))
        .filter((ref): ref is SourceRef => ref !== null);
    } catch (error) {
      logger.warn("Exa find-similar failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ApiError({
        code: "WEB_PROVIDER_REQUEST_FAILED",
        message: `Failed to find similar sources via Exa for: ${url}`,
        status: 502,
        details: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}
