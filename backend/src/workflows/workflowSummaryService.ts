import type { Firestore } from "firebase-admin/firestore";

import type { Workspace } from "../schemas/coreSchemas.js";
import { WorkflowService } from "./workflowService.js";

function formatNextRun(isoString: string): string {
  const ms = new Date(isoString).getTime() - Date.now();
  if (ms < 0) return "overdue";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.floor(hours / 24)}d`;
}

export class WorkflowSummaryService {
  private readonly workflowService: WorkflowService;

  constructor(private readonly db: Firestore) {
    this.workflowService = new WorkflowService(db);
  }

  async buildSummaryBlock(workspace: Workspace, limit = 6): Promise<string> {
    const all = await this.workflowService.listWorkflows(workspace);
    const custom = all.filter((w) => w.type !== "template");

    if (custom.length === 0) {
      return (
        "WORKSPACE WORKFLOWS: None configured yet. " +
        "Gideon can help create one — suggest it when the user describes a recurring task."
      );
    }

    const activeCount = custom.filter((w) => w.status === "active").length;
    const draftCount = custom.filter((w) => w.status === "draft").length;
    const pausedCount = custom.filter((w) => w.status === "paused").length;

    const attention: string[] = [];
    const wfLines: string[] = [];

    for (const wf of custom.slice(0, limit)) {
      const parts: string[] = [`"${wf.name}"`, wf.status, `trigger:${wf.triggerType}`];

      if (wf.triggerType === "scheduled" && wf.nextRunAt) {
        const rel = formatNextRun(wf.nextRunAt);
        parts.push(`next run: ${rel}`);
        if (rel === "overdue") attention.push(`"${wf.name}" scheduled run is overdue`);
      }

      if (wf.status === "paused") attention.push(`"${wf.name}" is paused`);

      wfLines.push(`  ${parts.join(" | ")}`);
    }

    const lines: string[] = [];
    lines.push(
      `WORKSPACE WORKFLOWS (${custom.length} total — ${activeCount} active, ${draftCount} draft, ${pausedCount} paused):`,
    );
    lines.push(...wfLines);

    if (custom.length > limit) {
      lines.push(`  ...and ${custom.length - limit} more`);
    }

    if (attention.length > 0) {
      lines.push(`Workflows needing attention: ${attention.slice(0, 3).join("; ")}`);
    }

    return lines.join("\n");
  }
}
