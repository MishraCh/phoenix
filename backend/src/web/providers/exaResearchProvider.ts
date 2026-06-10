import { Exa } from "exa-js";

import { env } from "../../config/env.js";
import { logger } from "../../observability/logger.js";
import { ApiError } from "../../utils/apiError.js";
import type { SourceRef } from "../../schemas/coreSchemas.js";

/** Thrown when bounded synchronous research exceeds its polling window — the caller backgrounds it. */
export class ResearchTimeoutError extends Error {
  constructor(public readonly researchId: string) {
    super(`Exa research ${researchId} did not finish within the bounded window`);
    this.name = "ResearchTimeoutError";
  }
}

export type ResearchEffort = "low" | "medium" | "high";

export type ResearchInput = {
  query: string;
  outputSchema?: Record<string, unknown>;
  effort?: ResearchEffort;
};

export type ResearchResult = {
  researchId: string;
  text: string;
  structured?: Record<string, unknown>;
  sourceRefs: SourceRef[];
};

const MODEL_BY_EFFORT: Record<ResearchEffort, string> = {
  low: "exa-research-fast",
  medium: "exa-research",
  high: "exa-research-pro",
};

type ResearchGetResponse = {
  status: string;
  output?: { content?: string; parsed?: Record<string, unknown> };
  error?: string;
};

/**
 * Deep research backed by Exa's Research API (exa.research.*).
 * - research(): bounded synchronous deep research (throws ResearchTimeoutError if slow).
 * - start()/poll(): async pair for backgrounded runs (the worker polls to completion).
 */
export class ExaResearchProvider {
  constructor(private readonly opts: { pollIntervalMs?: number; maxPolls?: number } = {}) {}

  private client(): Exa {
    if (!env.EXA_API_KEY) {
      throw new ApiError({
        code: "WEB_PROVIDER_CONFIG_MISSING",
        message: "EXA_API_KEY is required for Exa research.",
        status: 500,
      });
    }
    return new Exa(env.EXA_API_KEY);
  }

  async start(input: ResearchInput): Promise<{ researchId: string }> {
    const exa = this.client();
    const params: { instructions: string; model: string; outputSchema?: Record<string, unknown> } = {
      instructions: input.query,
      model: MODEL_BY_EFFORT[input.effort ?? "low"],
    };
    if (input.outputSchema) params.outputSchema = input.outputSchema;

    const response = (await exa.research.create(params as never)) as { researchId: string };
    return { researchId: response.researchId };
  }

  async poll(
    researchId: string,
  ): Promise<{ status: string; done: boolean; failed: boolean; result?: ResearchResult }> {
    const exa = this.client();
    const research = (await exa.research.get(researchId)) as ResearchGetResponse;

    if (research.status === "completed") {
      return { status: research.status, done: true, failed: false, result: this.mapResult(researchId, research.output) };
    }
    if (research.status === "failed" || research.status === "canceled") {
      return { status: research.status, done: true, failed: true };
    }
    return { status: research.status, done: false, failed: false };
  }

  /** Bounded synchronous deep research. Throws ResearchTimeoutError if it doesn't finish in time. */
  async research(input: ResearchInput): Promise<ResearchResult> {
    const { researchId } = await this.start(input);
    const maxPolls = this.opts.maxPolls ?? 15;
    const intervalMs = this.opts.pollIntervalMs ?? 4000;

    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      const polled = await this.poll(researchId);
      if (polled.done) {
        if (polled.failed || !polled.result) {
          throw new ApiError({
            code: "WEB_PROVIDER_REQUEST_FAILED",
            message: `Exa research failed (${researchId}).`,
            status: 502,
          });
        }
        logger.info("Exa research completed", { researchId, attempts: attempt + 1 });
        return polled.result;
      }
      await sleep(intervalMs);
    }

    logger.info("Exa research exceeded bounded window — backgrounding", { researchId });
    throw new ResearchTimeoutError(researchId);
  }

  private mapResult(
    researchId: string,
    output?: { content?: string; parsed?: Record<string, unknown> },
  ): ResearchResult {
    const text = typeof output?.content === "string" ? output.content : "";
    const result: ResearchResult = { researchId, text, sourceRefs: [] };
    if (output?.parsed) result.structured = output.parsed;
    return result;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
