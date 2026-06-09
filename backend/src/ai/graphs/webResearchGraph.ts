import { StateGraph, END, START } from "@langchain/langgraph";
import { z } from "zod";

import { createLlmProvider } from "../providers/providerRegistry.js";
import { AiBudgetExceededError } from "../execution/aiExecutionBudget.js";
import { DuckDuckGoSearchProvider } from "../../web/providers/duckduckgoSearchProvider.js";
import { OpenAIWebSearchProvider } from "../../web/providers/openAIWebSearchProvider.js";
import { ExaSearchProvider } from "../../web/providers/exaSearchProvider.js";
import { createSearchProvider, createExtractProvider } from "../../web/providers/providerFactory.js";
import { WebCrawlerProvider } from "../../web/providers/webCrawlerProvider.js";
import { env } from "../../config/env.js";

const urlPattern = /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s<>"{}|\\^[\]`]+)?/gi;

type WebResearchState = {
  prompt: string;
  processor: string;
  searchQueries: string[];
  scrapedContext: Array<{ url: string; title?: string; content: string }>;
  finalOutput?: string;
  finalCitations?: any[];
  contextPacket?: import("../../schemas/toolTypes.js").ToolContextPacket;
  semanticIntent?: string;
  depth?: "quick" | "standard" | "deep";
  gapDetected?: boolean;
  failedSources: string[];
  completeness?: number;
  confidence?: number;
};

const graphState = {
  prompt: { value: (x: string | undefined, y: string) => y ?? x ?? "", default: () => "" },
  processor: { value: (x: string | undefined, y: string) => y ?? x ?? "core", default: () => "core" },
  searchQueries: { value: (x: string[], y: string[]) => (x || []).concat(y || []), default: () => [] },
  scrapedContext: { value: (x: any[], y: any[]) => (x || []).concat(y || []), default: () => [] },
  finalOutput: { value: (x: string | undefined, y: string | undefined) => y ?? x, default: () => undefined },
  finalCitations: { value: (x: any[] | undefined, y: any[]) => y ?? x ?? [], default: () => [] },
  contextPacket: { value: (x: any | undefined, y: any) => y ?? x, default: () => undefined },
  semanticIntent: { value: (x: string | undefined, y: string | undefined) => y ?? x, default: () => undefined },
  depth: { value: (x: any, y: any) => y ?? x ?? "standard", default: () => "standard" as "quick" | "standard" | "deep" },
  gapDetected: { value: (x: boolean | undefined, y: boolean | undefined) => y ?? x ?? false, default: () => false },
  failedSources: { value: (x: string[], y: string[]) => (x || []).concat(y || []), default: () => [] },
  completeness: { value: (x: number | undefined, y: number | undefined) => y ?? x, default: () => undefined },
  confidence: { value: (x: number | undefined, y: number | undefined) => y ?? x, default: () => undefined },
};

async function generateSearchQueries(state: WebResearchState): Promise<Partial<WebResearchState>> {
  const llm = createLlmProvider("fast");
  const schema = z.object({
    queries: z.array(z.string()).min(1).max(3).describe("Search queries to find relevant information"),
  });

  let systemPrompt = "You are a research assistant. Generate 1-3 distinct Google search queries to gather information for the user's objective.\n\n" +
    "You should use the provided context to resolve any ambiguous references (e.g., 'research them' or 'find more about this company').";

  if (state.gapDetected && state.searchQueries && state.searchQueries.length > 0) {
    systemPrompt += `\n\nPREVIOUS QUERIES USED: ${state.searchQueries.join(", ")}\n` +
      "The previous queries did not yield sufficient evidence. Generate completely DIFFERENT, more specific, or deeper queries this time.";
  }

  const userPrompt = `${state.contextPacket?.workspaceContext ? `WORKSPACE IDENTITY:\n${state.contextPacket.workspaceContext}\n\n` : ""}` +
    `${state.contextPacket?.selectedItemContext ? `SELECTED ITEM CONTEXT:\n${state.contextPacket.selectedItemContext}\n\n` : ""}` +
    `${state.contextPacket?.sessionContext ? `RECENT CONVERSATION HISTORY:\n${state.contextPacket.sessionContext}\n\n` : ""}` +
    `OBJECTIVE:\n${state.prompt}`;

  const response = await llm.generateStructured({
    schema,
    systemPrompt,
    userPrompt,
  });

  return { searchQueries: response.queries };
}

async function searchAndScrape(state: WebResearchState): Promise<Partial<WebResearchState>> {
  const searchProvider = createSearchProvider();
  const fallbackProvider = new DuckDuckGoSearchProvider();

  const extractProvider = createExtractProvider();
  const crawlerProvider = new WebCrawlerProvider();

  const allUrls = new Set<string>();
  const scrapedContextLocal: Array<{ url: string; title?: string; content: string }> = [];
  const failedSources: string[] = [];
  const collectedCitations: Array<{
    url?: string;
    title?: string;
    snippet?: string;
    reasoning?: string;
    confidence?: number;
  }> = [];
  const searchQueries =
    searchProvider instanceof OpenAIWebSearchProvider || searchProvider instanceof ExaSearchProvider
      ? [state.prompt]
      : state.depth === "quick" || state.searchQueries.length === 0
        ? [state.prompt]
        : state.searchQueries;

  const directUrls = state.prompt.match(urlPattern) || [];
  const isReviewIntent = state.semanticIntent === "analyze_company" ||
    state.semanticIntent === "evaluate_website" ||
    /review|analyze|evaluate|company|competitor/i.test(state.semanticIntent || "") ||
    /review|analyze|evaluate|company|competitor/i.test(state.prompt);

  if (isReviewIntent && directUrls.length > 0) {
    try {
      const crawlResult = await crawlerProvider.crawl({
        baseUrl: directUrls[0]!,
        maxPages: 3,
        maxDepth: 1,
      });
      for (const page of crawlResult.pages) {
        scrapedContextLocal.push({
          url: page.url,
          title: page.title,
          content: page.content,
        });
      }
    } catch (e) {
      failedSources.push(directUrls[0] ?? "direct_url");
    }
  }

  await Promise.all(searchQueries.map(async (query) => {
    let openaiSuccess = false;
    if (searchProvider instanceof OpenAIWebSearchProvider || searchProvider instanceof ExaSearchProvider) {
      // Direct integration for synthesized-answer providers (OpenAI web_search / Exa answer)
      try {
        const result = await searchProvider.search({
          query,
          contextPacket: state.contextPacket,
          depth: state.depth === "deep" ? "deep" : "quick",
        });
        if (result.content && result.content.trim().length > 50) {
          scrapedContextLocal.push({
            url: "openai_search", // Meta URL indicating native response
            content: result.content
          });
          collectedCitations.push(
            ...result.sourceRefs.map((source) => ({
              url: source.url,
              title: source.title,
              snippet: result.content.slice(0, 280),
              reasoning: "Source returned by live web search.",
              confidence: source.confidence ?? 0.75,
            })),
          );
          openaiSuccess = true;
        } else {
          console.warn(`OpenAI Web Search returned weak/empty result for query: ${query}, falling back to DuckDuckGo`);
        }
      } catch (e) {
        if (
          e instanceof AiBudgetExceededError ||
          (e instanceof Error &&
            (e.name === "AbortError" || e.message.toLowerCase().includes("aborted")))
        ) {
          throw e;
        }
        failedSources.push(`openai_search:${query}`);
      }
    }

    if (!openaiSuccess) {
      // DuckDuckGo path
      const ddg = searchProvider instanceof DuckDuckGoSearchProvider ? searchProvider : fallbackProvider;
      try {
        const results = await ddg.search({ query, maxResults: 2 });
        for (const res of results) {
          allUrls.add(res.url);
        }
      } catch (e) {
        failedSources.push(`duckduckgo:${query}`);
      }
    }
  }));

  if (allUrls.size > 0) {
    try {
      const extractResult = await extractProvider.extract({
        urls: Array.from(allUrls),
        includeFullContent: true,
        contextPacket: state.contextPacket,
      });

      for (const page of extractResult.pages) {
        if (page.fullContent || page.excerpts.length > 0) {
          const content = page.fullContent ?? page.excerpts.join("\n");
          scrapedContextLocal.push({
            url: page.url,
            title: page.title,
            content,
          });
          collectedCitations.push({
            url: page.url,
            title: page.title,
            snippet: content.slice(0, 280),
            reasoning: "Page extracted from a live search result.",
            confidence: 0.7,
          });
        }
      }
    } catch (e) {
      failedSources.push(...Array.from(allUrls).map((url) => `extract:${url}`));
    }
  }

  const quickOutput =
    state.depth === "quick"
      ? scrapedContextLocal
        .slice(0, 8)
        .map((source) => {
          if (source.url === "openai_search") return source.content.trim();
          const excerpt = source.content.replace(/\s+/g, " ").trim().slice(0, 1_200);
          return `### ${source.title ?? "Search result"}\n${excerpt}`;
        })
        .filter(Boolean)
        .join("\n\n")
      : "";
  const evidenceCount = scrapedContextLocal.length;
  const attemptedCount = evidenceCount + failedSources.length;

  return {
    finalOutput: quickOutput,
    finalCitations: collectedCitations,
    scrapedContext: scrapedContextLocal,
    failedSources,
    completeness:
      state.depth === "quick"
        ? attemptedCount > 0
          ? evidenceCount / attemptedCount
          : 0
        : undefined,
    confidence:
      state.depth === "quick"
        ? collectedCitations.length > 0
          ? 0.75
          : evidenceCount > 0
            ? 0.45
            : 0.2
        : undefined,
  };
}

async function synthesize(state: WebResearchState): Promise<Partial<WebResearchState>> {
  const llm = state.processor === "lite" ? createLlmProvider("fast") : createLlmProvider("research");

  if (state.scrapedContext.length === 0) {
    return {
      finalOutput: "There is currently no direct information available in public web sources or the workspace context specifically about this topic. This may be a stealth or very early-stage entity, or details may not be widely indexed yet. To proceed, I recommend:\n\n1. Providing a direct URL (e.g., 'Review https://company.com')\n2. Letting me know if you want me to perform more targeted research on a specific market or competitor.",
      finalCitations: [],
      completeness: 0,
      confidence: 0.2,
    };
  }

  const contextString = state.scrapedContext
    .map((c, i) => `--- SOURCE [${i + 1}] ---\nURL: ${c.url}\nTitle: ${c.title}\nContent:\n${c.content.substring(0, 3000)}...\n`)
    .join("\n\n");

  const schema = z.object({
    content: z.string().describe("The comprehensive Markdown report addressing the user's prompt"),
    citations: z.array(z.object({
      url: z.string().describe("The exact URL from the provided context"),
      title: z.string().describe("The title of the source, or an empty string if unknown"),
      snippet: z.string().describe("A relevant excerpt supporting this citation"),
      reasoning: z.string().describe("Why this source is cited"),
      confidence: z.number().min(0).max(1).describe("Confidence in this source (0.0 to 1.0)"),
    })).describe("Citations backing up the claims in the content"),
    gapDetected: z.boolean().describe("Set to true if you are lacking sufficient facts to answer the objective and need to do another deeper search. Otherwise false."),
  });

  let modeInstructions = "Synthesize a comprehensive, well-structured Markdown report addressing the user's objective.";

  if (state.semanticIntent === "analyze_company" || state.semanticIntent === "evaluate_website" || state.prompt.toLowerCase().includes("review")) {
    modeInstructions = "Produce a structured Startup/Company Review. Include: Company summary, ICP (Target Customer), Value Prop, Strengths, Weaknesses/Gaps, Differentiation, Messaging review, GTM/funding suggestions, and Next Steps. Be opinionated and practically useful for founders.";
  } else if (state.prompt.toLowerCase().includes("grant") || state.prompt.toLowerCase().includes("funding")) {
    modeInstructions = "Produce structured Grant/Funding Research. Include: Region/Eligibility, Amount/Benefit, Deadline/Status, Fit score for the company, Why it fits, Next action. If geography is unclear, explicitly ask for the target region or clearly state assumptions. Always prioritize official sources.";
  } else if (state.prompt.toLowerCase().includes("news") || state.prompt.toLowerCase().includes("top")) {
    modeInstructions = "Produce a structured News Summary. Include: Ranked list, Full Headline, Source/Domain, Short summary, Why it matters. Do not truncate headlines.";
  }

  const guardrails = `QUALITY GUARDRAILS:
- Did you answer the actual ask, or just summarize?
- Do not hallucinate missing facts.
- Is a structured output (table/card) better than a paragraph?
- KEEP IT CONCISE: Do not exceed 1500 words. Be direct and dense with facts.
- EFFICIENCY HACK: If you decide to set 'gapDetected' to true, DO NOT write a full report. Just output "Gap detected, researching further..." in the 'content' field to save time.

CRITICAL SOURCE RULES (must follow exactly):
- DO NOT paste raw URLs, hyperlinks, or "Sources:" sections anywhere inside the 'content' field.
- Instead, use inline numbered references like [1], [2], [3] immediately after the claim they support.
- Example: "Recapi AI targets enterprise workflows [1] and uses behavioral learning [2]."
- All actual URLs must ONLY appear in the 'citations' array — never in the content body.
- The UI will render the citations list separately with links. Keep content text clean.`;

  const systemPrompt = `You are an expert research analyst. You have been given raw web pages from a search/crawl.
${modeInstructions}
You MUST extract exact citations from the provided context. Do NOT invent URLs or facts.
${guardrails}
${state.contextPacket?.workspaceContext ? `\nWORKSPACE IDENTITY:\n${state.contextPacket.workspaceContext}` : ""}
${state.contextPacket?.selectedItemContext ? `\nSELECTED ITEM CONTEXT:\n${state.contextPacket.selectedItemContext}` : ""}`;

  const userPrompt = `${state.contextPacket?.sessionContext ? `RECENT CONVERSATION HISTORY:\n${state.contextPacket.sessionContext}\n\n` : ""}OBJECTIVE:\n${state.prompt}\n\nWEB SEARCH CONTEXT:\n${contextString}`;

  try {
    const response = await llm.generateStructured({
      schema,
      systemPrompt,
      userPrompt,
      maxOutputTokens: 8000,
    });

    if (!response) {
      throw new Error("No structured output returned from LLM");
    }

    const citations = response.citations || [];

    return {
      finalOutput: response.content || "Synthesis complete, but no content was generated.",
      finalCitations: citations,
      gapDetected: response.gapDetected ?? false,
      completeness:
        state.failedSources.length === 0
          ? 1
          : Math.max(
            0.25,
            state.scrapedContext.length /
            (state.scrapedContext.length + state.failedSources.length),
          ),
      confidence:
        citations.length > 0
          ? Math.max(
            0.35,
            Math.min(
              0.95,
              citations.reduce(
                (sum, citation) => sum + (citation.confidence || 0.5),
                0,
              ) / citations.length,
            ),
          )
          : 0.3,
    };
  } catch (error) {
    const evidence = state.scrapedContext
      .slice(0, 6)
      .map((source, index) => {
        const excerpt = source.content.replace(/\s+/g, " ").trim().slice(0, 420);
        return `${index + 1}. ${source.title ?? "Research finding"}\n${excerpt}`;
      })
      .join("\n\n");
    return {
      finalOutput:
        "I found relevant live evidence, but the final synthesis could not complete within this request. Here are the validated partial findings:\n\n" +
        evidence,
      finalCitations: state.finalCitations ?? [],
      gapDetected: false,
      failedSources: [
        `synthesis:${error instanceof Error ? error.name : "unknown"}`,
      ],
      completeness: Math.min(0.75, Math.max(0.25, state.scrapedContext.length / 8)),
      confidence: 0.45,
    };
  }
}

function shouldRetry(state: WebResearchState) {
  if (state.depth === "deep" && state.gapDetected && state.searchQueries.length < 6) {
    return "plan";
  }
  return END;
}

export const webResearchGraph = new StateGraph<WebResearchState>({ channels: graphState })
  .addNode("plan", generateSearchQueries as any)
  .addNode("search_scrape", searchAndScrape as any)
  .addNode("synthesize", synthesize as any)
  .addConditionalEdges(
    START,
    (state) => state.depth === "quick" || env.WEB_SEARCH_PROVIDER === "openai_web_search" || env.WEB_SEARCH_PROVIDER === "exa" || env.WEB_SEARCH_PROVIDER === "miromind_api" ? "search_scrape" : "plan",
  )
  .addEdge("plan", "search_scrape")
  .addConditionalEdges(
    "search_scrape",
    (state) => state.depth === "quick" ? END : "synthesize",
  )
  .addConditionalEdges("synthesize", shouldRetry as any)
  .compile();
