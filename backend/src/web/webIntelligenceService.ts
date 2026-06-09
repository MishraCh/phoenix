import { createHash } from "node:crypto";

import type { Request } from "express";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";

import { ActivityService } from "../activity/activityService.js";
import { createLlmProvider } from "../ai/providers/providerRegistry.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { sourceRefSchema, type SourceRef } from "../schemas/coreSchemas.js";
import { ApiError } from "../utils/apiError.js";
import { createExtractProvider, type ExtractProvider } from "./providers/providerFactory.js";
import { ReasoningExtractProvider } from "./providers/reasoningExtractProvider.js";
import { OpenAIWebSearchProvider } from "./providers/openAIWebSearchProvider.js";
import { webResearchGraph } from "../ai/graphs/webResearchGraph.js";
import { WebIntelligenceRepository } from "./webIntelligenceRepository.js";
import { type WebCitation } from "./webIntelligenceSchemas.js";
import { env } from "../config/env.js";

type ResearchTaskInput = {
  currentWorkspace: CurrentWorkspace;
  userId: string;
  prompt: string;
  processor?: string;
  depth?: "quick" | "standard" | "deep";
  outputType?: "text" | "json";
  jsonSchema?: Record<string, unknown>;
  bypassCache?: boolean;
  activitySource?: "tool" | "system";
  contextPacket?: import("../schemas/toolTypes.js").ToolContextPacket;
  request?: Request;
  pollTimeoutSeconds?: number;
  maxPollAttempts?: number;
  pollIntervalMs?: number;
};

type ExtractUrlInput = {
  currentWorkspace: CurrentWorkspace;
  userId: string;
  urls: string[];
  objective?: string;
  searchQueries?: string[];
  includeFullContent?: boolean;
  sessionId?: string;
  bypassCache?: boolean;
  activitySource?: "tool" | "system";
  contextPacket?: import("../schemas/toolTypes.js").ToolContextPacket;
  request?: Request;
};

type StructuredExtractInput = Omit<ExtractUrlInput, "includeFullContent"> & {
  schemaName: string;
  schemaVersion: string;
  fields: Array<{ name: string; description: string; required?: boolean }>;
};

type MonitorCheckInput = {
  currentWorkspace: CurrentWorkspace;
  userId: string;
  targetType: "url" | "keyword" | "company" | "person";
  target: string;
  objective?: string;
  processor?: string;
  request?: Request;
};

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withProtocol).toString();
  } catch {
    throw new ApiError({
      code: "INVALID_URL",
      message: `"${url}" is not a valid URL. Include the full address starting with https://, for example: https://example.com`,
      status: 400,
    });
  }
}

function extractCitations(basis: unknown): WebCitation[] {
  const citations: WebCitation[] = [];

  const visit = (value: unknown, field?: string) => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, field));
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    const node = value as Record<string, unknown>;
    const nextField = typeof node.field === "string" ? node.field : field;

    if ("citations" in node && Array.isArray(node.citations)) {
      node.citations.forEach((citation) => {
        if (!citation || typeof citation !== "object") {
          return;
        }

        const citationRecord = citation as Record<string, unknown>;
        citations.push({
          field: nextField,
          title: typeof citationRecord.title === "string" ? citationRecord.title : undefined,
          url: typeof citationRecord.url === "string" ? citationRecord.url : undefined,
          snippet: typeof citationRecord.snippet === "string" ? citationRecord.snippet : undefined,
          reasoning: typeof node.reasoning === "string" ? node.reasoning : undefined,
          confidence: typeof node.confidence === "number" ? node.confidence : undefined,
        });
      });
    }

    Object.values(node).forEach((child) => visit(child, nextField));
  };

  visit(basis);

  return citations.filter((citation, index, array) => {
    const key = `${citation.field ?? ""}:${citation.url ?? ""}:${citation.snippet ?? ""}`;
    return array.findIndex((candidate) => `${candidate.field ?? ""}:${candidate.url ?? ""}:${candidate.snippet ?? ""}` === key) === index;
  });
}

function citationsToSourceRefs(citations: WebCitation[], provider: string): SourceRef[] {
  return citations
    .filter((citation) => citation.url)
    .map((citation) =>
      sourceRefSchema.parse({
        sourceType: "web",
        sourceId: hashValue(`${provider}:${citation.url}`),
        title: citation.title,
        url: citation.url,
        fetchedAt: Timestamp.now(),
        confidence: citation.confidence,
        provider,
      }),
    );
}

function pageToSourceRef(page: { url: string; title?: string }, provider: string): SourceRef {
  return sourceRefSchema.parse({
    sourceType: "web",
    sourceId: hashValue(`${provider}:${page.url}`),
    title: page.title,
    url: page.url,
    fetchedAt: Timestamp.now(),
    provider,
  });
}

function createDynamicSchema(fields: StructuredExtractInput["fields"]) {
  return z.object(
    Object.fromEntries(
      fields.map((field) => [
        field.name,
        field.required ? z.string().min(1) : z.string().optional(),
      ]),
    ),
  );
}

export class WebIntelligenceService {
  private readonly repository: WebIntelligenceRepository;
  private readonly extractProvider: ExtractProvider;
  private readonly reasoningExtractProvider: ReasoningExtractProvider;
  private readonly activityService: ActivityService;

  constructor(private readonly db: Firestore) {
    this.repository = new WebIntelligenceRepository(db);
    this.extractProvider = createExtractProvider();
    this.reasoningExtractProvider = new ReasoningExtractProvider();
    this.activityService = new ActivityService(db);
  }

  async runResearchTask(input: ResearchTaskInput) {
    const taskHash = hashValue(
      JSON.stringify({
        provider: "openai_graph",
        prompt: input.prompt,
        processor: input.processor ?? "core",
        depth: input.depth ?? "standard",
        outputType: input.outputType ?? "text",
        jsonSchema: input.jsonSchema ?? null,
      }),
    );

    if (!input.bypassCache) {
      const cached = await this.repository.getFreshTaskCache(input.currentWorkspace.id, taskHash);

      if (cached) {
        await this.activityService.createEvent({
          workspaceId: input.currentWorkspace.id,
          type: "web.research.cache_hit",
          title: "Web research reused from cache",
          actorType: input.activitySource === "tool" ? "agent" : "system",
          actorId: input.userId,
          metadata: { taskHash, provider: cached.provider },
        });

        return {
          ...cached,
          fromCache: true,
          partialResult:
            cached.freshness === "partial" || cached.failedSources.length > 0,
        };
      }
    }

    await this.activityService.createEvent({
      workspaceId: input.currentWorkspace.id,
      type: "web.research.started",
      title: "Web research started",
      actorType: input.activitySource === "tool" ? "agent" : "system",
      actorId: input.userId,
      metadata: { taskHash },
    });

    try {
      const state = await webResearchGraph.invoke({ 
        prompt: input.prompt, 
        processor: input.processor ?? "core",
        contextPacket: input.contextPacket,
        semanticIntent: input.contextPacket?.semanticIntent,
        depth: input.depth ?? "standard",
      } as any);
      const result = {
        run: { runId: `org_${Date.now()}` },
        basis: state.finalCitations,
        content: state.finalOutput,
        completeness: Number(state.completeness ?? 0),
        confidence: Number(state.confidence ?? 0),
        failedSources: Array.isArray(state.failedSources)
          ? state.failedSources.filter((value): value is string => typeof value === "string")
          : [],
      };
      
      const citations = extractCitations(result.basis);
      const sourceRefs = citationsToSourceRefs(citations, "openai_graph");
      
      const contentTextRaw = typeof result.content === "string" ? result.content : JSON.stringify(result.content, null, 2);
      const contentText = contentTextRaw.trim().length > 0 ? contentTextRaw : "Research completed but no relevant content was found or extracted.";
      
      const cache = await this.repository.saveTaskCache({
        workspaceId: input.currentWorkspace.id,
        taskHash,
        provider: "openai_graph",
        prompt: input.prompt,
        processor: input.processor ?? "core",
        content: result.content as string,
        contentText,
        contentHash: hashValue(contentText),
        sourceRefs,
        citations,
        confidence: result.confidence,
        completeness: result.completeness,
        freshness: result.failedSources.length ? "partial" : "fresh",
        failedSources: result.failedSources,
        cacheVersion: "web-task-cache.v2",
        providerConfigurationHash: hashValue(
          `${env.WEB_RESEARCH_PROVIDER}:${env.WEB_SEARCH_PROVIDER}:${input.processor ?? "core"}`,
        ),
        taskRunId: result.run.runId,
        ttlMinutes:
          /\b(today|latest|current|news|recent|recently)\b/i.test(input.prompt)
            ? 30
            : input.depth === "deep"
              ? 60 * 24
              : 60 * 6,
      });

      await this.repository.upsertSources(
        input.currentWorkspace.id,
        "openai_graph",
        sourceRefs,
        citations,
        cache.contentHash,
      );
      await this.activityService.createEvent({
        workspaceId: input.currentWorkspace.id,
        type: "web.research.completed",
        title: "Web research completed",
        actorType: input.activitySource === "tool" ? "agent" : "system",
        actorId: input.userId,
        metadata: {
          taskHash,
          taskRunId: result.run.runId,
          provider: "openai_graph",
          sourceCount: sourceRefs.length,
        },
      });

      return {
        ...cache,
        fromCache: false,
        partialResult: cache.freshness === "partial",
      };
    } catch (error) {
      await this.activityService.createEvent({
        workspaceId: input.currentWorkspace.id,
        type: "web.research.failed",
        title: "Web research failed",
        actorType: input.activitySource === "tool" ? "agent" : "system",
        actorId: input.userId,
        metadata: {
          taskHash,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
      throw error;
    }
  }

  async extractUrl(input: ExtractUrlInput) {
    const normalizedUrls = input.urls.map(normalizeUrl);
    const primaryUrl = normalizedUrls[0];
    const urlHash = hashValue(primaryUrl);

    if (!input.bypassCache) {
      const cached = await this.repository.getFreshPageCache(input.currentWorkspace.id, urlHash);

      if (cached) {
        await this.activityService.createEvent({
          workspaceId: input.currentWorkspace.id,
          type: "web.extract.cache_hit",
          title: "Page extraction reused from cache",
          actorType: input.activitySource === "tool" ? "agent" : "system",
          actorId: input.userId,
          metadata: { urlHash, provider: cached.provider },
        });

        return { ...cached, fromCache: true };
      }
    }

    await this.activityService.createEvent({
      workspaceId: input.currentWorkspace.id,
      type: "web.extract.started",
      title: "Page extraction started",
      actorType: input.activitySource === "tool" ? "agent" : "system",
      actorId: input.userId,
      metadata: { urlHash, urls: normalizedUrls },
    });

    try {
      let page: { url: string; title?: string; publishDate?: string; excerpts: string[]; fullContent?: string; } | undefined;
      let usedProvider = "cheerio_extract";
      let resultSessionId = input.sessionId;

      try {
        const result = await this.extractProvider.extract({
          urls: normalizedUrls,
          objective: input.objective,
          searchQueries: input.searchQueries,
          includeFullContent: input.includeFullContent,
          sessionId: input.sessionId,
          contextPacket: input.contextPacket,
          request: input.request,
        });
        page = result.pages[0];
        resultSessionId = result.sessionId;
        usedProvider = (result as { providerUsed?: string }).providerUsed ?? usedProvider;

        if (!page) {
          throw new Error("Extraction provider did not return any page results.");
        }
      } catch (cheerioError) {
        console.warn(`Cheerio extraction failed for ${primaryUrl}, falling back to OpenAI Web Search`, cheerioError);
        const searchProvider = new OpenAIWebSearchProvider();
        const searchResult = await searchProvider.search({
          query: `Extract the content of this specific URL: ${primaryUrl}`,
          contextPacket: input.contextPacket,
          request: input.request,
        });

        if (!searchResult.content || searchResult.content.trim().length < 50) {
          throw new ApiError({
            code: "WEB_PROVIDER_REQUEST_FAILED",
            message: `Could not extract content from ${primaryUrl}. The page may be blocked, dynamic, or inaccessible.`,
            status: 502,
          });
        }

        usedProvider = "openai_web_search";
        page = {
          url: primaryUrl,
          title: "Extracted Content (Fallback)",
          excerpts: [searchResult.content],
          fullContent: searchResult.content,
        };
      }

      const sourceRefs = [pageToSourceRef(page, usedProvider)];
      const contentText = [page.excerpts.join("\n\n"), page.fullContent ?? ""].filter(Boolean).join("\n\n");
      const cache = await this.repository.savePageCache({
        workspaceId: input.currentWorkspace.id,
        url: page.url,
        urlHash,
        provider: usedProvider,
        sessionId: resultSessionId,
        title: page.title,
        publishDate: page.publishDate,
        excerpts: page.excerpts,
        fullContent: page.fullContent,
        contentText,
        contentHash: hashValue(contentText),
        sourceRefs,
        freshness: "fresh",
        cacheVersion: "web-page-cache.v2",
        providerConfigurationHash: hashValue(usedProvider),
      });

      await this.repository.upsertSources(
        input.currentWorkspace.id,
        "reasoning_extract",
        sourceRefs,
        [],
        cache.contentHash,
      );
      await this.activityService.createEvent({
        workspaceId: input.currentWorkspace.id,
        type: "web.extract.completed",
        title: "Page extraction completed",
        actorType: input.activitySource === "tool" ? "agent" : "system",
        actorId: input.userId,
        metadata: {
          urlHash,
          provider: "reasoning_extract",
          sessionId: resultSessionId ?? null,
        },
      });

      return { ...cache, fromCache: false };
    } catch (error) {
      await this.activityService.createEvent({
        workspaceId: input.currentWorkspace.id,
        type: "web.extract.failed",
        title: "Page extraction failed",
        actorType: input.activitySource === "tool" ? "agent" : "system",
        actorId: input.userId,
        metadata: {
          urlHash,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
      throw error;
    }
  }

  async extractStructured(input: StructuredExtractInput) {
    const inputHash = hashValue(
      JSON.stringify({
        urls: input.urls,
        schemaName: input.schemaName,
        schemaVersion: input.schemaVersion,
        fields: input.fields,
      }),
    );
    const cached = await this.repository.getStructuredExtractionCache(
      input.currentWorkspace.id,
      inputHash,
    );

    if (cached && !input.bypassCache) {
      return { ...cached, fromCache: true };
    }

    const schema = createDynamicSchema(input.fields);
    
    // Build an objective string for the extraction model
    const objective = [
      `Extract the requested structured facts from the web page. Only return fields supported by the content. Do not invent values.`,
      `Schema name: ${input.schemaName}@${input.schemaVersion}`,
      `Requested fields: ${input.fields.map((field) => `${field.name}: ${field.description}`).join("; ")}`,
      input.objective ? `Additional Context: ${input.objective}` : ""
    ].filter(Boolean).join("\n");

    const result = await this.reasoningExtractProvider.extract({
      urls: input.urls,
      objective,
      sessionId: input.sessionId,
      includeFullContent: true,
      contextPacket: input.contextPacket,
      request: input.request,
    });

    const page = result.pages[0];
    if (!page) {
      throw new ApiError({
        code: "WEB_PROVIDER_REQUEST_FAILED",
        message: "Failed to extract structured data from URLs.",
        status: 502,
      });
    }

    const llm = createLlmProvider("reasoning");
    const structured = await llm.generateStructured({
      schema,
      systemPrompt: "Format the extracted content into the requested structured schema. Do not invent values if they are not present in the extraction.",
      userPrompt: `Page Title: ${page.title ?? "Unknown"}\nContent:\n${page.fullContent ?? page.excerpts.join("\n\n")}`,
    });

    const sourceRefs = [pageToSourceRef(page, result.providerUsed)];

    const saved = await this.repository.saveStructuredExtractionCache({
      workspaceId: input.currentWorkspace.id,
      url: page.url,
      schemaName: input.schemaName,
      schemaVersion: input.schemaVersion,
      inputHash,
      provider: result.providerUsed,
      output: structured,
      sourceRefs,
    });

    return { ...saved, fromCache: false };
  }

  async monitorCheck(input: MonitorCheckInput) {
    if (input.targetType === "url") {
      const previous = await this.repository.getLatestPageCache(
        input.currentWorkspace.id,
        hashValue(normalizeUrl(input.target)),
      );
      const current = await this.extractUrl({
        currentWorkspace: input.currentWorkspace,
        userId: input.userId,
        urls: [input.target],
        objective: input.objective,
        includeFullContent: true,
        bypassCache: true,
        activitySource: "tool",
        request: input.request,
      });
      const changed = previous ? previous.contentHash !== current.contentHash : true;

      await this.activityService.createEvent({
        workspaceId: input.currentWorkspace.id,
        type: "web.monitor.checked",
        title: "Monitor check completed",
        actorType: "system",
        actorId: input.userId,
        metadata: {
          targetType: input.targetType,
          target: input.target,
          changed,
          provider: "reasoning_extract",
        },
      });

      return {
        provider: "reasoning_extract",
        targetType: input.targetType,
        target: input.target,
        changed,
        previousContentHash: previous?.contentHash ?? null,
        currentContentHash: current.contentHash,
        contentText: current.contentText,
        sourceRefs: current.sourceRefs,
      };
    }

    const prompt =
      input.objective ??
      `Find meaningful new public information about ${input.targetType} "${input.target}" and summarize the changes.`;
    const previous = await this.repository.getLatestTaskCache(
      input.currentWorkspace.id,
      hashValue(
        JSON.stringify({
          provider: "openai_graph",
          prompt,
          processor: input.processor ?? "core",
          outputType: "text",
          jsonSchema: null,
        }),
      ),
    );
    const current = await this.runResearchTask({
      currentWorkspace: input.currentWorkspace,
      userId: input.userId,
      prompt,
      processor: input.processor ?? "core",
      bypassCache: true,
      activitySource: "tool",
      request: input.request,
    });
    const changed = previous ? previous.contentHash !== current.contentHash : true;

    await this.activityService.createEvent({
      workspaceId: input.currentWorkspace.id,
      type: "web.monitor.checked",
      title: "Monitor check completed",
      actorType: "system",
      actorId: input.userId,
      metadata: {
        targetType: input.targetType,
        target: input.target,
        changed,
        provider: "openai_graph",
      },
    });

    return {
      provider: "openai_graph",
      targetType: input.targetType,
      target: input.target,
      changed,
      previousContentHash: previous?.contentHash ?? null,
      currentContentHash: current.contentHash,
      contentText: current.contentText,
      sourceRefs: current.sourceRefs,
    };
  }
}
