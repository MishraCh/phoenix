import * as cheerio from "cheerio";
import type { Request } from "express";

import { timeRequestPhase } from "../../observability/requestTiming.js";
import { ApiError } from "../../utils/apiError.js";

export type CheerioExtractInput = {
  urls: string[];
  objective?: string;
  searchQueries?: string[];
  sessionId?: string;
  includeFullContent?: boolean;
  contextPacket?: import("../../schemas/toolTypes.js").ToolContextPacket;
  request?: Request;
};

export type CheerioExtractPage = {
  url: string;
  title?: string;
  publishDate?: string;
  excerpts: string[];
  fullContent?: string;
};

export type CheerioExtractResult = {
  extractId: string;
  sessionId?: string;
  pages: CheerioExtractPage[];
};

export class CheerioHtmlExtractProvider {
  async extract(input: CheerioExtractInput): Promise<CheerioExtractResult> {
    const pages: CheerioExtractPage[] = [];

    for (const url of input.urls) {
      try {
        const response = await timeRequestPhase(input.request, "cheerio_extract.fetch", async () =>
          fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.5",
            },
          }),
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // Remove unnecessary elements
        $("script, style, noscript, iframe, img, svg, video, audio").remove();

        const title = $("title").text().trim() || undefined;
        let content = $("body").text();

        // Clean up whitespace
        content = content.replace(/\s+/g, " ").trim();

        // Very basic excerpt generation (just the first 500 chars for now, LLM handles the rest)
        const excerpt = content.length > 500 ? content.substring(0, 500) + "..." : content;

        pages.push({
          url,
          title,
          excerpts: [excerpt],
          fullContent: input.includeFullContent ? content : undefined,
        });
      } catch (error) {
        throw new ApiError({
          code: "WEB_PROVIDER_REQUEST_FAILED",
          message: `Failed to extract URL: ${url}`,
          status: 502,
          details: { error: error instanceof Error ? error.message : String(error) },
        });
      }
    }

    return {
      extractId: `ext_${Date.now()}`,
      sessionId: input.sessionId,
      pages,
    };
  }
}
