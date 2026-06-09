import { z } from "zod";

import { createLlmProvider } from "../../ai/providers/providerRegistry.js";
import { timeRequestPhase } from "../../observability/requestTiming.js";
import { ApiError } from "../../utils/apiError.js";
import { CheerioHtmlExtractProvider } from "./cheerioHtmlExtractProvider.js";
import { OpenAIWebSearchProvider } from "./openAIWebSearchProvider.js";
import type { Request } from "express";

export type ReasoningExtractInput = {
  urls: string[];
  objective?: string;
  sessionId?: string;
  includeFullContent?: boolean;
  contextPacket?: import("../../schemas/toolTypes.js").ToolContextPacket;
  request?: Request;
};

export type ReasoningExtractPage = {
  url: string;
  title?: string;
  publishDate?: string;
  excerpts: string[];
  fullContent?: string;
};

export type ReasoningExtractResult = {
  extractId: string;
  sessionId?: string;
  pages: ReasoningExtractPage[];
  providerUsed: "reasoning_extract";
};

const extractionSchema = z.object({
  title: z.string().optional(),
  summary: z.string().describe("Comprehensive summary or extracted content from the URL"),
  excerpts: z.array(z.string()).describe("Exact relevant excerpts or citations extracted from the URL"),
  publishDate: z.string().optional(),
  success: z.boolean().describe("Whether the page was successfully extracted"),
});

export class ReasoningExtractProvider {
  private readonly htmlProvider: CheerioHtmlExtractProvider;

  constructor() {
    this.htmlProvider = new CheerioHtmlExtractProvider();
  }

  async extract(input: ReasoningExtractInput): Promise<ReasoningExtractResult> {
    const pages: ReasoningExtractPage[] = [];

    for (const url of input.urls) {
      try {
        let rawContent = "";
        let rawTitle = "Extracted Content";

        try {
          // Step 1: Fetch raw HTML using Cheerio
          const cheerioResult = await this.htmlProvider.extract({
            urls: [url],
            includeFullContent: true,
            request: input.request,
          });

          const rawPage = cheerioResult.pages[0];
          if (!rawPage || (!rawPage.fullContent && rawPage.excerpts.length === 0)) {
            throw new Error("HTML extraction yielded empty content");
          }
          rawContent = rawPage.fullContent ?? rawPage.excerpts.join("\n");
          rawTitle = rawPage.title ?? rawTitle;
        } catch (cheerioError) {
          console.warn(`Cheerio extraction failed for ${url} in ReasoningExtract, falling back to OpenAI`, cheerioError);
          const searchProvider = new OpenAIWebSearchProvider();
          const searchResult = await searchProvider.search({
            query: `Extract the entire text content of this specific URL: ${url}`,
            contextPacket: input.contextPacket,
            request: input.request,
          });

          if (!searchResult.content || searchResult.content.trim().length < 50) {
            throw new Error("OpenAI fallback extraction yielded empty content");
          }
          rawContent = searchResult.content;
          rawTitle = "Extracted Content (Fallback)";
        }

        // Step 2: Use Reasoning Model to synthesize
        const llm = createLlmProvider("reasoning");
        const synthesizeResponse = await timeRequestPhase(input.request, "openai_extract.synthesize", async () => {
          return llm.generateStructured({
            schema: extractionSchema,
            systemPrompt: "You are a web extraction agent. Extract the requested information from the provided raw HTML content.",
            userPrompt: [
              `Target URL: ${url}`,
              input.objective ? `Objective: ${input.objective}` : "",
              `Raw Content:\n${rawContent}`
            ].filter(Boolean).join("\n"),
          });
        });

        pages.push({
          url,
          title: synthesizeResponse.title ?? rawTitle,
          publishDate: synthesizeResponse.publishDate,
          excerpts: synthesizeResponse.excerpts.length > 0 ? synthesizeResponse.excerpts : [synthesizeResponse.summary],
          fullContent: input.includeFullContent ? synthesizeResponse.summary : undefined,
        });
      } catch (error) {
        throw new ApiError({
          code: "WEB_PROVIDER_REQUEST_FAILED",
          message: `Failed to extract URL via reasoning synthesis: ${url}`,
          status: 502,
          details: { error: error instanceof Error ? error.message : String(error) },
        });
      }
    }

    return {
      extractId: `ext_${Date.now()}`,
      sessionId: input.sessionId,
      pages,
      providerUsed: "reasoning_extract",
    };
  }
}
