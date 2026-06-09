import { Cron } from "croner";

import type { WorkflowStep } from "../schemas/coreSchemas.js";

export function validateCron(cron: string, timezone: string): boolean {
  try {
    new Cron(cron, { timezone, paused: true });
    return true;
  } catch {
    return false;
  }
}

export function computeNextRunAt(cron: string, timezone: string): Date {
  const job = new Cron(cron, { timezone, paused: true });
  const next = job.nextRun();
  if (!next) throw new Error(`Cron "${cron}" has no future occurrences`);
  return next;
}

const PLACEHOLDER_REGEX = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

export function inferPlaceholders(steps: WorkflowStep[]): string[] {
  const names = new Set<string>();

  function scanValue(value: unknown): void {
    if (typeof value === "string") {
      for (const match of value.matchAll(PLACEHOLDER_REGEX)) {
        if (match[1]) names.add(match[1]);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) scanValue(item);
    } else if (value && typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) scanValue(v);
    }
  }

  for (const step of steps) {
    scanValue(step.config);
    scanValue(step.name);
  }

  return Array.from(names);
}

export function substituteInput(value: unknown, inputs: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(PLACEHOLDER_REGEX, (_, name: string) => inputs[name] ?? `{{${name}}}`);
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteInput(item, inputs));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = substituteInput(v, inputs);
    }
    return result;
  }
  return value;
}
