"use client";
import { useEffect, useRef } from "react";

const NAMED_EVENTS = [
  "command.started",
  "command.context_loaded",
  "command.tool_started",
  "command.tool_completed",
  "command.planning",
  "command.synthesizing",
  "command.token",
  "command.completed",
  "command.failed",
  "workflow.run.started",
  "workflow.step.started",
  "workflow.step.completed",
  "workflow.step.failed",
  "workflow.waiting_approval",
  "workflow.run.completed",
  "workflow.run.failed",
  "approval.created",
  "approval.approved",
  "approval.rejected",
  "notification.created",
];

// Exponential backoff: 2s → 4s → 8s → 16s → 30s (capped)
const BACKOFF_DELAYS = [2_000, 4_000, 8_000, 16_000, 30_000];

type SseStreamOptions = {
  getUrl: () => Promise<string> | string;
  onEvent: (event: string, data: unknown) => void;
  enabled?: boolean;
};

export function useSseStream({ getUrl, onEvent, enabled = true }: SseStreamOptions) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const getUrlRef = useRef(getUrl);
  getUrlRef.current = getUrl;

  useEffect(() => {
    if (!enabled) return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let connectedOnce = false;
    let cancelled = false;

    async function connect() {
      if (cancelled) return;

      const url = await getUrlRef.current();
      if (!url || cancelled) return;

      es = new EventSource(url);

      es.addEventListener("connected", (e) => {
        // Reset backoff on successful connection
        attempt = 0;
        connectedOnce = true;
        onEventRef.current("connected", JSON.parse((e as MessageEvent).data as string));
      });

      es.onerror = () => {
        es?.close();
        es = null;
        if (cancelled) return;

        // If we never connected at all, this URL is likely auth-rejected — back off aggressively
        if (!connectedOnce) {
          attempt = Math.min(attempt + 1, BACKOFF_DELAYS.length - 1);
        }
        const delay = BACKOFF_DELAYS[attempt] ?? 30_000;
        // Reset connectedOnce so the next attempt's first error also backs off
        connectedOnce = false;
        reconnectTimer = setTimeout(() => { void connect(); }, delay);
      };

      for (const name of NAMED_EVENTS) {
        es.addEventListener(name, (e) => {
          onEventRef.current(name, JSON.parse((e as MessageEvent).data as string));
        });
      }
    }

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [enabled]);
}
