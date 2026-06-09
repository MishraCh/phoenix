import type { Request } from "express";

export type RequestTimingState = {
  phases: Record<string, number>;
  metadata: Record<string, unknown>;
};

function ensureTimingState(request: Request) {
  if (!request.requestTiming) {
    request.requestTiming = {
      phases: {},
      metadata: {},
    };
  }

  return request.requestTiming;
}

export function addRequestTiming(request: Request, phase: string, durationMs: number) {
  const state = ensureTimingState(request);
  state.phases[phase] = Number(((state.phases[phase] ?? 0) + durationMs).toFixed(2));
}

export function setRequestTimingMetadata(request: Request, key: string, value: unknown) {
  const state = ensureTimingState(request);
  state.metadata[key] = value;
}

export async function timeRequestPhase<T>(request: Request | undefined, phase: string, work: () => Promise<T>) {
  if (!request) {
    return work();
  }

  const startedAt = performance.now();

  try {
    return await work();
  } finally {
    addRequestTiming(request, phase, performance.now() - startedAt);
  }
}
