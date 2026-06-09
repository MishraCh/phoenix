"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Clock3,
  Coins,
  RefreshCw,
  Route,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusPill } from "@/components/ui/StatusPill";
import { useAuth } from "@/hooks/useAuth";
import {
  getAiOperationsOverview,
  type AiOperationsOverview,
  type AiOperationsTrace,
} from "@/services/aiOperations";

import { PageSection, SummaryRow } from "./ProductPrimitives";
import { ProductHeader } from "./ProductHeader";

function percent(value: number) {
  return `${(value * 100).toFixed(value > 0 && value < 0.01 ? 1 : 0)}%`;
}

function duration(value = 0) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function traceDate(value: AiOperationsTrace["createdAt"]) {
  if (!value) return "Unknown";
  if (typeof value === "string") return new Date(value).toLocaleString();
  const seconds = value.seconds ?? value._seconds;
  return seconds ? new Date(seconds * 1000).toLocaleString() : "Unknown";
}

export function AiOperationsPage() {
  const { idToken } = useAuth();
  const [overview, setOverview] = useState<AiOperationsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!idToken) return;
    setLoading(true);
    setError(null);
    try {
      setOverview(await getAiOperationsOverview(idToken));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "AI operations data could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [idToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const routeRows = Object.entries(overview?.routeDistribution ?? {}).sort(
    ([, left], [, right]) => right - left,
  );

  return (
    <section className="space-y-6">
      <ProductHeader
        eyebrow="Internal operations"
        title="AI reliability"
        description="Workspace-scoped routing, latency, token use, and execution health for the controlled migration."
        actions={
          <Button variant="outline" className="rounded-full" onClick={() => void load()}>
            <RefreshCw className="mr-2 size-4" />
            Refresh
          </Button>
        }
        meta={
          <SummaryRow
            className="md:grid-cols-2 xl:grid-cols-4"
            items={[
              {
                label: "Requests",
                value: overview?.requestVolume ?? 0,
                detail: "Recent traced requests in this workspace.",
                icon: Activity,
                tone: "primary",
              },
              {
                label: "P95 latency",
                value: duration(overview?.latencyMs.p95),
                detail: "End-to-end duration across recent traces.",
                icon: Clock3,
                tone:
                  (overview?.latencyMs.p95 ?? 0) > 8_000 ? "warning" : "success",
              },
              {
                label: "Error rate",
                value: percent(overview?.errorRate ?? 0),
                detail: `${percent(overview?.partialResultRate ?? 0)} partial results.`,
                icon: TriangleAlert,
                tone: (overview?.errorRate ?? 0) > 0.02 ? "warning" : "neutral",
              },
              {
                label: "Model calls",
                value: overview?.usage.llmCalls ?? 0,
                detail: `${(overview?.usage.inputTokens ?? 0).toLocaleString()} input tokens.`,
                icon: Coins,
                tone: "neutral",
              },
            ]}
          />
        }
      />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <PageSection
          title="Recent traces"
          description="The route, result state, model calls, and end-to-end duration for each request."
        >
          {loading && !overview ? (
            <LoadingState label="Loading AI traces..." rows={5} />
          ) : overview?.recentTraces.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-border/60 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  <tr>
                    <th className="pb-3 font-semibold">Route</th>
                    <th className="pb-3 font-semibold">Provider</th>
                    <th className="pb-3 font-semibold">Status</th>
                    <th className="pb-3 font-semibold">Latency</th>
                    <th className="pb-3 font-semibold">Calls</th>
                    <th className="pb-3 text-right font-semibold">Recorded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/45">
                  {overview.recentTraces.map((trace) => (
                    <tr key={trace.id} className="transition-colors hover:bg-background/70">
                      <td className="py-4 font-medium text-foreground">
                        {trace.routeDecision?.intent ?? "unknown"}
                      </td>
                      <td className="py-4 text-muted-foreground">
                        {trace.routeDecision?.provider ?? "internal"}
                      </td>
                      <td className="py-4">
                        <StatusPill status={trace.status ?? "unknown"} />
                      </td>
                      <td className="py-4 text-muted-foreground">
                        {duration(trace.totals?.durationMs)}
                      </td>
                      <td className="py-4 text-muted-foreground">
                        {trace.totals?.llmCalls ?? 0}
                      </td>
                      <td className="py-4 text-right text-xs text-muted-foreground">
                        {traceDate(trace.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No traces are available yet. Enable `AI_TRACE_V2` and run a command.
            </p>
          )}
        </PageSection>

        <PageSection
          title="Route mix"
          description="Use this to spot provider false triggers and unexpected classifier drift."
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 border-b border-border/45 pb-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  V1/V2 agreement
                </p>
                <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                  {percent(overview?.routingEvaluation.agreementRate ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  False triggers
                </p>
                <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                  {percent(overview?.routingEvaluation.providerFalseTriggerRate ?? 0)}
                </p>
              </div>
            </div>
            {routeRows.length ? (
              routeRows.map(([intent, count]) => {
                const share = overview?.requestVolume
                  ? Math.round((count / overview.requestVolume) * 100)
                  : 0;
                return (
                  <div key={intent}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2 font-medium text-foreground">
                        <Route className="size-3.5 text-primary" />
                        {intent.replace(/_/g, " ")}
                      </span>
                      <span className="text-muted-foreground">{count}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-500"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">No routing data yet.</p>
            )}
          </div>
        </PageSection>
      </div>
    </section>
  );
}
