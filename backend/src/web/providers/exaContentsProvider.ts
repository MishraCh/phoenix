import type { Request } from "express";
import { Exa } from "exa-js";

import { env } from "../../config/env.js";
import { ApiError } from "../../utils/apiError.js";

export type ExaContentsInput = {
  urls: string[];
  objective?: string;
  searchQueries?: string[];
  sessionId?: string;
  includeFullContent?: boolean;
  contextPacket?: import("../../schemas/toolTypes.js").ToolContextPacket;
  request?: Request;
};

export type ExaContentsPage = {
  url: string;
  title?: string;
  publishDate?: string;
  excerpts: string[];
  fullContent?: string;
};

export type ExaContentsResult = {
  extractId: string;
  sessionId?: string;
  pages: ExaContentsPage[];
  providerUsed?: string;
};

/**
 * Extraction provider backed by Exa's /contents endpoint.
 * Matches CheerioHtmlExtractProvider's { extractId, pages } contract so it
 * slots into the existing extract pipeline.
 */
export class ExaContentsProvider {
  async extract(input: ExaContentsInput): Promise<ExaContentsResult> {
    if (!env.EXA_API_KEY) {
      throw new ApiError({
        code: "WEB_PROVIDER_CONFIG_MISSING",
        message: "EXA_API_KEY is required for the Exa contents provider.",
        status: 500,
      });
    }
    if (input.urls.length === 0) {
      return {
        extractId: `ext_${Date.now()}`,
        sessionId: input.sessionId,
        pages: [],
        providerUsed: "exa_contents",
      };
    }

    const exa = new Exa(env.EXA_API_KEY);

    try {
      const response = await exa.getContents(input.urls, {
        text: true,
        highlights: true,
        summary: true,
      });

      const results = Array.isArray(response.results) ? response.results : [];
      const pages: ExaContentsPage[] = results.map((result: Record<string, any>) => {
        const highlights: string[] = Array.isArray(result.highlights)
          ? result.highlights.filter((h: unknown): h is string => typeof h === "string")
          : [];
        const summary = typeof result.summary === "string" ? result.summary : undefined;
        const text = typeof result.text === "string" ? result.text : undefined;
        const snippet = text ? (text.length > 500 ? `${text.slice(0, 500)}...` : text) : undefined;
        const excerpts =
          highlights.length > 0 ? highlights : summary ? [summary] : snippet ? [snippet] : [];

        return {
          url: String(result.url),
          title: typeof result.title === "string" ? result.title : undefined,
          publishDate: typeof result.publishedDate === "string" ? result.publishedDate : undefined,
          excerpts,
          fullContent: input.includeFullContent ? text : undefined,
        };
      });

      return {
        extractId: `ext_${Date.now()}`,
        sessionId: input.sessionId,
        pages,
        providerUsed: "exa_contents",
      };
    } catch (error) {
      throw new ApiError({
        code: "WEB_PROVIDER_REQUEST_FAILED",
        message: `Failed to extract URLs via Exa: ${input.urls.join(", ")}`,
        status: 502,
        details: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}
