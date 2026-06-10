import { Exa } from "exa-js";
import { Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

import { env } from "../../config/env.js";
import { logger } from "../../observability/logger.js";
import { sourceRefSchema, type SourceRef } from "../../schemas/coreSchemas.js";
import { ApiError } from "../../utils/apiError.js";

export type WebsetEntity = "company" | "person";

export type WebsetEnrichmentSpec = {
  description: string;
  format?: "text" | "number" | "email" | "url" | "date";
};

export type WebsetCreateInput = {
  query: string;
  count?: number;
  entity?: WebsetEntity;
  enrichments?: WebsetEnrichmentSpec[];
};

/** A single normalized dataset row from a Webset item. */
export type DatasetRow = {
  id: string;
  properties: Record<string, unknown>;
  enrichments: Record<string, unknown>;
  sourceRefs: SourceRef[];
};

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Pull a string-ish value out of an enrichment result (which may be an array or scalar). */
function extractEnrichmentValue(result: unknown): unknown {
  if (Array.isArray(result)) return result.map((r) => (typeof r === "object" ? JSON.stringify(r) : r)).join(", ");
  if (result && typeof result === "object") return JSON.stringify(result);
  return result ?? null;
}

/** Best-effort URL extraction from an item's properties (entity payloads vary). */
function extractUrl(properties: Record<string, unknown>): string | undefined {
  if (typeof properties.url === "string") return properties.url;
  for (const value of Object.values(properties)) {
    if (value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string") {
      return (value as { url: string }).url;
    }
  }
  return undefined;
}

/**
 * Lead-dataset builder backed by Exa Websets. Websets run asynchronously
 * (minutes) — callers create + poll + fetch items from a background job.
 */
export class ExaWebsetsProvider {
  private client(): Exa {
    if (!env.EXA_API_KEY) {
      throw new ApiError({
        code: "WEB_PROVIDER_CONFIG_MISSING",
        message: "EXA_API_KEY is required for Exa Websets.",
        status: 500,
      });
    }
    return new Exa(env.EXA_API_KEY);
  }

  async create(input: WebsetCreateInput): Promise<{ websetId: string }> {
    const exa = this.client();
    const search: { query: string; count?: number; entity?: { type: WebsetEntity } } = { query: input.query };
    if (input.count) search.count = input.count;
    if (input.entity) search.entity = { type: input.entity };

    const params: Record<string, unknown> = { search };
    if (input.enrichments?.length) {
      params.enrichments = input.enrichments.map((e) => ({
        description: e.description,
        ...(e.format ? { format: e.format } : {}),
      }));
    }

    const webset = (await exa.websets.create(params as never)) as { id: string };
    logger.info("Exa webset created", { websetId: webset.id });
    return { websetId: webset.id };
  }

  async poll(websetId: string): Promise<{ status: string; idle: boolean }> {
    const exa = this.client();
    const webset = (await exa.websets.get(websetId)) as { status?: string };
    const status = webset.status ?? "unknown";
    return { status, idle: status === "idle" };
  }

  async items(websetId: string): Promise<DatasetRow[]> {
    const exa = this.client();
    const response = (await exa.websets.items.list(websetId)) as unknown as {
      data?: Array<{
        id?: string;
        properties?: Record<string, unknown>;
        enrichments?: Array<{ enrichmentId?: string; title?: string; description?: string; result?: unknown }>;
      }>;
    };

    const items = Array.isArray(response.data) ? response.data : [];
    return items.map((item, index) => {
      const properties = item.properties ?? {};
      const enrichments: Record<string, unknown> = {};
      for (const [i, e] of (item.enrichments ?? []).entries()) {
        const label = e.title ?? e.description ?? e.enrichmentId ?? `field_${i + 1}`;
        enrichments[label] = extractEnrichmentValue(e.result);
      }
      const url = extractUrl(properties);
      const sourceRefs = url
        ? [
            sourceRefSchema.parse({
              sourceType: "web",
              sourceId: hashValue(`exa_webset:${url}`),
              title: typeof properties.name === "string" ? properties.name : "Lead source",
              url,
              fetchedAt: Timestamp.now(),
              provider: "exa_websets",
            }),
          ]
        : [];
      return { id: item.id ?? `row_${index + 1}`, properties, enrichments, sourceRefs };
    });
  }
}
