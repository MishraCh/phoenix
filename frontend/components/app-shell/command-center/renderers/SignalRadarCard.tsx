"use client";

import { cn } from "@/lib/utils";
import type { SignalRadarPayload } from "@/services/command";
import { CardShell, Chips, ConfidenceMeter, SectionLabel } from "./CardShell";
import { MissingDataState } from "./MissingDataState";

type UrgencyLevel = "low" | "medium" | "high" | "critical";

const URGENCY_DOT: Record<UrgencyLevel, string> = {
  low: "bg-slate-400",
  medium: "bg-amber-400",
  high: "bg-orange-500",
  critical: "bg-rose-600",
};

const URGENCY_BADGE: Record<UrgencyLevel, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-rose-100 text-rose-800",
};

export function SignalRadarCard({ payload }: { payload: SignalRadarPayload }) {
  if (payload.status && payload.status !== "ready" && payload.status !== "success" && payload.status !== "partial") {
    return (
      <MissingDataState
        status={payload.status}
        searchMetadata={payload.searchMetadata}
        title="Signals Unavailable"
      />
    );
  }

  const signals = payload.signals ?? [];
  const implications = payload.implications ?? [];
  const suggestedMoves = payload.suggestedMoves ?? [];
  const source = payload.searchMetadata?.sourceUsed ?? null;
  const urgency = (payload.urgency ?? "low") as UrgencyLevel;

  return (
    <CardShell type="signal_radar" sourceLabel={source}>
      <div className="space-y-5">
        {payload.status === "partial" && payload.searchMetadata && (
          <MissingDataState
            status={payload.status}
            searchMetadata={payload.searchMetadata}
            title="Partial Data Available"
          />
        )}

        {/* Summary + urgency badge */}
        <div className="flex items-start justify-between gap-3">
          {payload.summary && (
            <p className="flex-1 text-[15px] leading-7 text-foreground/90">{payload.summary}</p>
          )}
          {payload.urgency && (
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize",
                URGENCY_BADGE[urgency] ?? URGENCY_BADGE.low,
              )}
            >
              {payload.urgency} urgency
            </span>
          )}
        </div>

        {/* Signal rows with urgency dot */}
        {signals.length > 0 && (
          <div className="space-y-2.5">
            <SectionLabel>Signals</SectionLabel>
            {signals.map((signal, i) => {
              const sigUrgency = ((signal as { urgency?: string }).urgency ?? urgency) as UrgencyLevel;
              return (
                <div
                  key={i}
                  className="flex gap-3 rounded-xl border border-border/50 bg-muted/20 px-4 py-3"
                >
                  <div className="mt-1.5 flex shrink-0 flex-col items-center gap-1">
                    <div
                      className={cn(
                        "size-2 rounded-full",
                        URGENCY_DOT[sigUrgency] ?? URGENCY_DOT.low,
                      )}
                    />
                    {i < signals.length - 1 && (
                      <div className="w-px flex-1 bg-border/40" style={{ minHeight: 8 }} />
                    )}
                  </div>
                  <div className="flex-1 space-y-0.5">
                    <p className="text-[14px] font-semibold text-foreground">{signal.title}</p>
                    <p className="text-[13px] leading-5 text-foreground/80">{signal.whyItMatters}</p>
                    {signal.implication && (
                      <p className="text-[12px] leading-5 text-muted-foreground">
                        {signal.implication}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Implications + Suggested moves */}
        {(implications.length > 0 || suggestedMoves.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {implications.length > 0 && (
              <div>
                <SectionLabel>Implications</SectionLabel>
                <Chips items={implications} tone="warning" />
              </div>
            )}
            {suggestedMoves.length > 0 && (
              <div>
                <SectionLabel>Suggested Moves</SectionLabel>
                <ol className="space-y-1.5 pl-4 text-[14px] leading-6 text-foreground/86 [list-style-type:decimal]">
                  {suggestedMoves.map((move, i) => (
                    <li key={i}>{move}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        <ConfidenceMeter confidence={payload.confidence} />
      </div>
    </CardShell>
  );
}
