import type { Firestore } from "firebase-admin/firestore";

import { ArtifactService } from "../artifacts/artifactService.js";
import { NotificationService } from "../notifications/notificationService.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { logger } from "../observability/logger.js";
import type { JobLock, SourceRef } from "../schemas/coreSchemas.js";
import { ExaWebsetsProvider, type DatasetRow } from "../web/providers/exaWebsetsProvider.js";

type ProcessOpts = { pollIntervalMs?: number; maxPolls?: number };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readInput(job: JobLock): Record<string, unknown> {
  const input = job.payload?.input;
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

/** Pull a display name out of an item's (variable-shaped) properties. */
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

  return { kind: "dataset" as const, entity, query, columns, rows: datasetRows, generatedBy: "exa_websets" as const };
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

/**
 * Background processor for `exa_webset_poll` jobs. Polls the Exa Webset until it
 * is idle (bounded — worker timeout is 3600s), then saves the enriched dataset
 * as a `data` artifact and notifies the user. On timeout/failure it notifies too
 * (never a silent drop).
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
  const userId = typeof job.payload?.userId === "string" ? job.payload.userId : "";

  const notifications = new NotificationService(db);

  if (!websetId) {
    throw new Error("exa_webset_poll jobs require a websetId.");
  }

  const provider = new ExaWebsetsProvider();
  const maxPolls = opts.maxPolls ?? 36;
  const intervalMs = opts.pollIntervalMs ?? 20_000;

  try {
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
    const dataset = buildDataset(entity, query, rows);

    const workspace = await new WorkspaceRepository(db).getWorkspace(job.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${job.workspaceId} not found for webset artifact.`);
    }

    const artifact = await new ArtifactService(db).createArtifact({
      workspace,
      userId,
      title: label,
      artifactType: "data",
      content: JSON.stringify(dataset),
      sourceRefs: dedupeSources(rows),
      creationSource: "command_explicit",
    });

    await notifications.createNotification({
      workspaceId: job.workspaceId,
      userId: userId || undefined,
      type: "report_ready",
      title: "Your lead dataset is ready",
      body: `${rows.length} ${entity === "person" ? "people" : "companies"} enriched — "${label}".`,
      related: { artifactId: artifact.id },
    });

    logger.info("Exa webset dataset saved", { websetId, artifactId: artifact.id, rows: rows.length });
    return { resultRef: `workspaces/${job.workspaceId}/artifacts/${artifact.id}` };
  } catch (error) {
    logger.warn("Exa webset processing failed", {
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
    return { resultRef: `webset:${websetId}:failed` };
  }
}
