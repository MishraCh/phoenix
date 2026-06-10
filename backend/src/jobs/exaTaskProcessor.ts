import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { z } from "zod";

import { ArtifactService } from "../artifacts/artifactService.js";
import { NotificationService } from "../notifications/notificationService.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { logger } from "../observability/logger.js";
import { sourceRefSchema, type JobLock, type SourceRef } from "../schemas/coreSchemas.js";
import { ExaWebsetsProvider, type DatasetRow } from "../web/providers/exaWebsetsProvider.js";
import { ExaSearchProvider } from "../web/providers/exaSearchProvider.js";
import { createLlmProvider } from "../ai/providers/providerRegistry.js";

type ProcessOpts = { pollIntervalMs?: number; maxPolls?: number };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readInput(job: JobLock): Record<string, unknown> {
  const input = job.payload?.input;
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function webSourceRef(url: string, title: string): SourceRef | null {
  try {
    return sourceRefSchema.parse({
      sourceType: "web",
      sourceId: createHash("sha256").update(`exa_dataset:${url}`).digest("hex"),
      title: title || "Lead source",
      url,
      fetchedAt: Timestamp.now(),
      provider: "exa_websets",
    });
  } catch {
    return null;
  }
}

function rowName(properties: Record<string, unknown>): string {
  if (typeof properties.name === "string") return properties.name;
  for (const value of Object.values(properties)) {
    if (value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string") {
      return (value as { name: string }).name;
    }
  }
  return "Untitled";
}

function rowUrl(row: DatasetRow): string {
  if (typeof row.properties.url === "string") return row.properties.url;
  return row.sourceRefs[0]?.url ?? "";
}

/** Build the dataset payload stored in the artifact (drives the frontend table card). */
function buildDataset(entity: string, query: string, rows: DatasetRow[]) {
  const enrichmentKeys = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row.enrichments)) enrichmentKeys.add(key);

  const columns = [
    { key: "name", label: "Name" },
    { key: "url", label: "URL" },
    ...Array.from(enrichmentKeys).map((key) => ({ key, label: key })),
  ];

  const datasetRows = rows.map((row) => ({
    id: row.id,
    cells: { name: rowName(row.properties), url: rowUrl(row), ...row.enrichments } as Record<string, unknown>,
    sourceRefs: row.sourceRefs,
  }));

  return { kind: "dataset" as const, entity, query, columns, rows: datasetRows, generatedBy: "exa" as const };
}

function dedupeSources(rows: DatasetRow[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const row of rows) {
    for (const ref of row.sourceRefs) {
      const key = ref.url ?? ref.sourceId;
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(ref);
      }
    }
  }
  return out;
}

/** Build dataset rows by searching for entities and enriching each (no Websets — works on any Exa plan). */
async function searchEnrichItems(
  query: string,
  count: number,
  enrichmentDescriptions: string[],
): Promise<DatasetRow[]> {
  const results = await new ExaSearchProvider().searchEntities(query, count);
  const rows: DatasetRow[] = [];

  for (const result of results) {
    const enrichments: Record<string, unknown> = {};
    if (enrichmentDescriptions.length && result.text) {
      try {
        const extractionSchema = z.object({
          fields: z.array(z.object({ name: z.string(), value: z.string().nullable() })),
        });
        const extracted = await createLlmProvider("fast").generateStructured({
          schema: extractionSchema,
          systemPrompt:
            "You extract the requested fields about an entity from web content. Set value to null when a field is unknown.",
          userPrompt: `Entity: ${result.name}\nFields: ${enrichmentDescriptions.join(", ")}\n\nContent:\n${result.text}\n\nReturn 'fields' as an array of { name, value }.`,
        });
        for (const field of (extracted as { fields?: Array<{ name?: string; value?: unknown }> }).fields ?? []) {
          if (field?.name) enrichments[field.name] = field.value ?? null;
        }
      } catch (error) {
        logger.warn("Dataset row enrichment failed; keeping base entity", {
          entity: result.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const ref = webSourceRef(result.url, result.name);
    rows.push({
      id: createHash("sha256").update(result.url).digest("hex"),
      properties: { name: result.name, url: result.url },
      enrichments,
      sourceRefs: ref ? [ref] : [],
    });
  }

  return rows;
}

async function saveDataset(
  db: Firestore,
  job: JobLock,
  args: { label: string; entity: string; query: string; rows: DatasetRow[]; userId: string },
): Promise<{ resultRef: string }> {
  const dataset = buildDataset(args.entity, args.query, args.rows);
  const workspace = await new WorkspaceRepository(db).getWorkspace(job.workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${job.workspaceId} not found for dataset artifact.`);
  }

  const artifact = await new ArtifactService(db).createArtifact({
    workspace,
    userId: args.userId,
    title: args.label,
    artifactType: "data",
    content: JSON.stringify(dataset),
    sourceRefs: dedupeSources(args.rows),
    creationSource: "command_explicit",
  });

  await new NotificationService(db).createNotification({
    workspaceId: job.workspaceId,
    userId: args.userId || undefined,
    type: "report_ready",
    title: "Your lead dataset is ready",
    body: `${args.rows.length} ${args.entity === "person" ? "people" : "companies"} enriched — "${args.label}".`,
    related: { artifactId: artifact.id },
  });

  logger.info("Exa dataset saved", { artifactId: artifact.id, rows: args.rows.length });
  return { resultRef: `workspaces/${job.workspaceId}/artifacts/${artifact.id}` };
}

/**
 * Background processor for `exa_webset_poll` jobs. Two modes:
 *  - websetId present → poll the Exa Webset until idle, then fetch items.
 *  - mode "search_enrich" (fallback when Websets is unavailable) → search + enrich inline.
 * Both produce the same `data` dataset artifact + notification. Always notifies on
 * timeout/failure (never a silent drop).
 */
export async function processExaWebset(
  db: Firestore,
  job: JobLock,
  opts: ProcessOpts = {},
): Promise<{ resultRef: string }> {
  const input = readInput(job);
  const websetId = typeof input.websetId === "string" ? input.websetId : null;
  const label = typeof input.label === "string" ? input.label : "Lead dataset";
  const entity = typeof input.entity === "string" ? input.entity : "company";
  const query = typeof input.query === "string" ? input.query : "";
  const count = typeof input.count === "number" ? input.count : 10;
  const enrichmentDescriptions = Array.isArray(input.enrichments)
    ? (input.enrichments as Array<{ description?: unknown }>)
        .map((e) => (typeof e?.description === "string" ? e.description : null))
        .filter((d): d is string => d !== null)
    : [];
  const userId = typeof job.payload?.userId === "string" ? job.payload.userId : "";

  const notifications = new NotificationService(db);

  try {
    if (websetId) {
      const provider = new ExaWebsetsProvider();
      const maxPolls = opts.maxPolls ?? 36;
      const intervalMs = opts.pollIntervalMs ?? 20_000;
      let idle = false;
      for (let attempt = 0; attempt < maxPolls; attempt += 1) {
        const status = await provider.poll(websetId);
        if (status.idle) {
          idle = true;
          break;
        }
        await sleep(intervalMs);
      }
      if (!idle) {
        logger.warn("Exa webset did not become idle within the bounded window", { websetId });
        await notifications.createNotification({
          workspaceId: job.workspaceId,
          userId: userId || undefined,
          type: "integration_error",
          title: "Lead dataset is still building",
          body: `"${label}" is taking longer than expected. I'll keep it and you can retry shortly.`,
        });
        return { resultRef: `webset:${websetId}:timeout` };
      }
      const rows = await provider.items(websetId);
      return await saveDataset(db, job, { label, entity, query, rows, userId });
    }

    // Fallback path: search + enrich (no Websets dependency).
    const rows = await searchEnrichItems(query, count, enrichmentDescriptions);
    if (!rows.length) {
      await notifications.createNotification({
        workspaceId: job.workspaceId,
        userId: userId || undefined,
        type: "integration_error",
        title: "No leads found",
        body: `I couldn't find results for "${label}". Try a broader query.`,
      });
      return { resultRef: `dataset:${job.id}:empty` };
    }
    return await saveDataset(db, job, { label, entity, query, rows, userId });
  } catch (error) {
    logger.warn("Exa dataset processing failed", {
      websetId,
      error: error instanceof Error ? error.message : String(error),
    });
    await notifications.createNotification({
      workspaceId: job.workspaceId,
      userId: userId || undefined,
      type: "integration_error",
      title: "Lead dataset failed",
      body: `I couldn't finish building "${label}". Please try again.`,
    });
    return { resultRef: `dataset:${job.id}:failed` };
  }
}
