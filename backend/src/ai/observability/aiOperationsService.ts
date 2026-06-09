import type { Firestore } from "firebase-admin/firestore";

function percentile(values: number[], quantile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0;
}

export class AiOperationsService {
  constructor(private readonly db: Firestore) {}

  async getOverview(workspaceId: string, limit = 200) {
    const [traces, usage] = await Promise.all([
      this.db
        .collection("workspaces")
        .doc(workspaceId)
        .collection("aiTraces")
        .orderBy("createdAt", "desc")
        .limit(Math.min(limit, 500))
        .get(),
      this.db
        .collection("workspaces")
        .doc(workspaceId)
        .collection("aiUsageEvents")
        .orderBy("createdAt", "desc")
        .limit(Math.min(limit * 3, 1000))
        .get(),
    ]);
    const traceRows: Array<Record<string, unknown>> = traces.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    const durations = traceRows.map((row) =>
      Number((row["totals"] as Record<string, unknown> | undefined)?.["durationMs"] ?? 0),
    );
    const routeCounts: Record<string, number> = {};
    let partial = 0;
    let errors = 0;
    let routeComparisons = 0;
    let routeAgreements = 0;
    let providerFalseTriggers = 0;
    for (const row of traceRows) {
      const intent = String(
        (row["routeDecision"] as Record<string, unknown> | undefined)?.["intent"] ?? "unknown",
      );
      routeCounts[intent] = (routeCounts[intent] ?? 0) + 1;
      if (row["status"] === "partial") partial += 1;
      if (row["status"] === "failed") errors += 1;
      const comparison = row["routeComparison"] as Record<string, unknown> | undefined;
      if (comparison) {
        routeComparisons += 1;
        if (comparison["agreement"] === true) routeAgreements += 1;
        if (comparison["providerFalseTrigger"] === true) providerFalseTriggers += 1;
      }
    }
    const usageRows = usage.docs.map((doc) => doc.data());

    return {
      requestVolume: traceRows.length,
      latencyMs: {
        p50: percentile(durations, 0.5),
        p95: percentile(durations, 0.95),
      },
      errorRate: traceRows.length ? errors / traceRows.length : 0,
      partialResultRate: traceRows.length ? partial / traceRows.length : 0,
      routingEvaluation: {
        comparisons: routeComparisons,
        agreementRate: routeComparisons ? routeAgreements / routeComparisons : 0,
        providerFalseTriggerRate: routeComparisons
          ? providerFalseTriggers / routeComparisons
          : 0,
      },
      routeDistribution: routeCounts,
      usage: {
        llmCalls: usageRows.length,
        inputTokens: usageRows.reduce((sum, row) => sum + Number(row["inputTokens"] ?? 0), 0),
        outputTokens: usageRows.reduce((sum, row) => sum + Number(row["outputTokens"] ?? 0), 0),
        estimatedCost: usageRows.reduce(
          (sum, row) => sum + Number(row["estimatedProviderCost"] ?? 0),
          0,
        ),
      },
      recentTraces: traceRows.slice(0, 25),
    };
  }

  async getTrace(workspaceId: string, traceId: string) {
    const snapshot = await this.db
      .collection("workspaces")
      .doc(workspaceId)
      .collection("aiTraces")
      .doc(traceId)
      .get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  }
}
