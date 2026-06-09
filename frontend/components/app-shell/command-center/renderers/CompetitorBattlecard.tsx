"use client";

import type { CompetitorBattlecardPayload } from "@/services/command";
import { CardShell, ConfidenceMeter, SectionLabel, CalloutBlock } from "./CardShell";
import { MissingDataState } from "./MissingDataState";
import { CheckCircle2, XCircle, Crosshair, Eye } from "lucide-react";

export function CompetitorBattlecard({ payload }: { payload: CompetitorBattlecardPayload }) {
  if (payload.status && payload.status !== "ready" && payload.status !== "success" && payload.status !== "partial") {
    return (
      <MissingDataState
        status={payload.status}
        searchMetadata={payload.searchMetadata}
        title="Battlecard Unavailable"
      />
    );
  }

  const strengths = payload.strengths ?? [];
  const weaknesses = payload.weaknesses ?? [];
  const attackAngles = payload.attackAngles ?? [];
  const watchItems = payload.watchItems ?? [];
  const source = payload.searchMetadata?.sourceUsed ?? null;

  return (
    <CardShell type="competitor_battlecard" sourceLabel={source}>
      <div className="space-y-6">
        {payload.status === "partial" && payload.searchMetadata && (
          <MissingDataState
            status={payload.status}
            searchMetadata={payload.searchMetadata}
            title="Partial Data Available"
          />
        )}

        {/* Executive Summary & Overview */}
        {(payload.summary || payload.competitorOverview) && (
          <div className="space-y-4 border-b border-border/50 pb-5">
            {payload.summary && (
              <div>
                <p className="text-[15px] font-medium leading-relaxed text-foreground/90">
                  {payload.summary}
                </p>
              </div>
            )}
            {payload.competitorOverview && (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4 shadow-sm">
                <SectionLabel>Market Positioning & Overview</SectionLabel>
                <p className="mt-1.5 text-[14px] leading-relaxed text-foreground/80">
                  {payload.competitorOverview}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Two-column Us vs Them */}
        {(strengths.length > 0 || weaknesses.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {strengths.length > 0 && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 shadow-sm">
                <SectionLabel>Our Strengths</SectionLabel>
                <ul className="mt-3 flex flex-col gap-2.5">
                  {strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-emerald-900">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {weaknesses.length > 0 && (
              <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-4 shadow-sm">
                <SectionLabel>Their Weaknesses</SectionLabel>
                <ul className="mt-3 flex flex-col gap-2.5">
                  {weaknesses.map((w, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-rose-900">
                      <XCircle className="mt-0.5 size-4 shrink-0 text-rose-600" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Positioning gap */}
        {payload.positioningGap && (
          <div>
            <SectionLabel>Positioning Gap</SectionLabel>
            <CalloutBlock tone="info">
              <p className="text-[14px] leading-relaxed">{payload.positioningGap}</p>
            </CalloutBlock>
          </div>
        )}

        {/* Attack angles */}
        {attackAngles.length > 0 && (
          <div>
            <SectionLabel>Attack Angles</SectionLabel>
            <div className="mt-2 rounded-xl border border-sky-100 bg-sky-50/30 p-4 shadow-sm">
              <ul className="flex flex-col gap-3">
                {attackAngles.map((angle, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[14px] leading-relaxed text-sky-900">
                    <Crosshair className="mt-[3px] size-4 shrink-0 text-sky-600" />
                    <span>{angle}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Watch items */}
        {watchItems.length > 0 && (
          <div>
            <SectionLabel>Watch Items</SectionLabel>
            <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50/30 p-4 shadow-sm">
              <ul className="flex flex-col gap-3">
                {watchItems.map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[14px] leading-relaxed text-amber-900">
                    <Eye className="mt-[3px] size-4 shrink-0 text-amber-600" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <ConfidenceMeter confidence={payload.confidence} />
      </div>
    </CardShell>
  );
}
