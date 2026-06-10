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
        sourceRefs: uniqueCitations.map((citation) =>
          sourceRefSchema.parse({
            sourceType: "web",
            sourceId: hashValue(`exa_search:${citation.url}`),
            title: citation.title ?? "Web result",
            url: citation.url,
            fetchedAt: Timestamp.now(),
            provider: "exa_search",
          }),
        ),
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
        .filter((result): result is { url: string; title?: string } => typeof result.url === "string")
        .map((result) =>
          sourceRefSchema.parse({
            sourceType: "web",
            sourceId: hashValue(`exa_find_similar:${result.url}`),
            title: result.title ?? "Related result",
            url: result.url,
            fetchedAt: Timestamp.now(),
            provider: "exa_find_similar",
          }),
        );
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
