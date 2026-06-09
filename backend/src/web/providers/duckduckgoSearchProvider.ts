// @ts-ignore
import ddg from "duckduckgo-search";

// duckduckgo-search has a bug where it calls console.warning instead of console.warn
if (!(console as any).warning) {
  (console as any).warning = console.warn;
}
import type { Request } from "express";

import { timeRequestPhase } from "../../observability/requestTiming.js";
import { ApiError } from "../../utils/apiError.js";

export type DuckDuckGoSearchInput = {
  query: string;
  maxResults?: number;
  request?: Request;
};

export type DuckDuckGoSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export class DuckDuckGoSearchProvider {
  async search(input: DuckDuckGoSearchInput): Promise<DuckDuckGoSearchResult[]> {
    try {
      const results = await timeRequestPhase(input.request, "web_search.ddg", async () => {
        const rawResults = [];
        const limit = input.maxResults ?? 5;
        const searchGen = ddg.text(input.query, { safeSearch: "moderate" });
        for await (const result of searchGen) {
          rawResults.push(result);
          if (rawResults.length >= limit) break;
        }
        return rawResults;
      });

      return results.map((result: any) => ({
        title: result.title,
        url: result.url,
        snippet: result.description,
      }));
    } catch (error) {
      throw new ApiError({
        code: "WEB_PROVIDER_REQUEST_FAILED",
        message: `Failed to search DuckDuckGo for query: ${input.query}`,
        status: 502,
        details: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}
