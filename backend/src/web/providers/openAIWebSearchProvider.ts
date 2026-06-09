import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI, tools } from "@langchain/openai";
import type { Request } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

import {
  AiBudgetExceededError,
  estimateTokens,
  getAiExecutionContext,
} from "../../ai/execution/aiExecutionBudget.js";
import { env } from "../../config/env.js";
import { logger } from "../../observability/logger.js";
import { timeRequestPhase } from "../../observability/requestTiming.js";
import { sourceRefSchema, type SourceRef } from "../../schemas/coreSchemas.js";
import { ApiError } from "../../utils/apiError.js";

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

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

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

export class OpenAIWebSearchProvider {
  async search(input: OpenAIWebSearchInput): Promise<OpenAIWebSearchResult> {
    const execution = getAiExecutionContext();
    let systemContext = "You are a web search extraction tool. Search live public sources and return a raw, dense factual summary of the evidence. Do not use conversational language like 'Here is what I found'. Provide only factual evidence and cite sources.";
    if (input.contextPacket?.workspaceContext) {
      systemContext += `\n\nWORKSPACE CONTEXT:\n${input.contextPacket.workspaceContext}`;
    }
    if (input.contextPacket?.sessionContext) {
      systemContext += `\n\nSESSION CONTEXT:\n${input.contextPacket.sessionContext}`;
    }
    if (input.contextPacket?.selectedItemContext) {
      systemContext += `\n\nSELECTED ITEM:\n${input.contextPacket.selectedItemContext}`;
    }

    const estimatedInputTokens = estimateTokens(`${systemContext}\n${input.query}`);
    const maxOutputTokens =
      execution?.budget.reserveCall(
        estimatedInputTokens,
        input.depth === "deep" ? 2_500 : 1_600,
      ) ?? (input.depth === "deep" ? 2_500 : 1_600);
    const startedAt = performance.now();
    const model = env.OPENAI_FAST_MODEL ?? env.OPENAI_CHAT_MODEL ?? "gpt-5.4-mini";
    const providerTimeoutMs = Math.max(
      1_000,
      Math.min(60_000, execution?.budget.deadlineRemainingMs() ?? 60_000),
    );

    logger.info("OpenAI web search started", {
      requestId: execution?.requestId,
      model,
      depth: input.depth ?? "quick",
      providerTimeoutMs,
      remainingBudget: execution?.budget.remaining(),
    });

    try {
      const response = await timeRequestPhase(input.request, "web_search.openai", () =>
        new ChatOpenAI({
          apiKey: env.OPENAI_API_KEY,
          model,
          maxTokens: maxOutputTokens,
          timeout: providerTimeoutMs,
          useResponsesApi: true,
        }).invoke(
          [
            new SystemMessage(systemContext),
            new HumanMessage(input.query),
          ],
          {
            tools: [
              tools.webSearch({
                search_context_size: input.depth === "deep" ? "medium" : "low",
              }),
            ],
            signal: execution?.signal,
          },
        ),
      );

      const parsed = parseOpenAIWebSearchContent(response.content);
      if (!parsed.text) {
        throw new Error("No web-search response content was returned.");
      }

      const usage = response.usage_metadata;
      const outputTokens =
        usage?.output_tokens ?? estimateTokens(parsed.text);
      execution?.budget.recordGeneratedTokens(outputTokens);
      execution?.recordUsage({
        provider: "openai",
        model,
        role: "web_search",
        inputTokens: usage?.input_tokens ?? estimatedInputTokens,
        outputTokens,
        latencyMs: Number((performance.now() - startedAt).toFixed(2)),
        success: true,
        estimated: !usage,
        scope: "execution",
      });

      const uniqueCitations = parsed.citations.filter(
        (citation, index, all) =>
          all.findIndex((candidate) => candidate.url === citation.url) === index,
      );
      logger.info("OpenAI web search completed", {
        requestId: execution?.requestId,
        model,
        depth: input.depth ?? "quick",
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        citationCount: uniqueCitations.length,
        outputTokens,
      });
      return {
        content: parsed.text,
        sourceRefs: uniqueCitations.map((citation) =>
          sourceRefSchema.parse({
            sourceType: "web",
            sourceId: hashValue(`openai_search:${citation.url}`),
            title: citation.title ?? "Web result",
            url: citation.url,
            fetchedAt: Timestamp.now(),
            provider: "openai_web_search",
          }),
        ),
      };
    } catch (error) {
      execution?.recordUsage({
        provider: "openai",
        model,
        role: "web_search",
        inputTokens: estimatedInputTokens,
        outputTokens: 0,
        latencyMs: Number((performance.now() - startedAt).toFixed(2)),
        success: false,
        errorCode: error instanceof Error ? error.name : "UNKNOWN",
        estimated: true,
        scope: "execution",
      });
      logger.warn("OpenAI web search failed", {
        requestId: execution?.requestId,
        model,
        depth: input.depth ?? "quick",
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        remainingBudget: execution?.budget.remaining(),
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof AiBudgetExceededError) throw error;
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))
      ) {
        throw error;
      }
      throw new ApiError({
        code: "WEB_PROVIDER_REQUEST_FAILED",
        message: `Failed to search web via OpenAI: ${input.query}`,
        status: 502,
        details: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}
