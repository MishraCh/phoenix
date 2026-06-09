"use client";

import type { OutreachDraftPayload } from "@/services/command";
import { CardShell, Chips, ConfidenceMeter, SectionLabel } from "./CardShell";
import { MissingDataState } from "./MissingDataState";

export function OutreachDraftCard({ payload }: { payload: OutreachDraftPayload }) {
  if (payload.status && payload.status !== "ready" && payload.status !== "success" && payload.status !== "partial") {
    return (
      <MissingDataState
        status={payload.status}
        searchMetadata={payload.searchMetadata}
        title="Outreach Draft Unavailable"
      />
    );
  }

  const rationale = payload.rationale ?? [];
  const variants = payload.variants ?? [];
  const source = payload.searchMetadata?.sourceUsed ?? null;

  return (
    <CardShell type="outreach_draft" sourceLabel={source}>
      <div className="space-y-5">
        {payload.status === "partial" && payload.searchMetadata && (
          <MissingDataState
            status={payload.status}
            searchMetadata={payload.searchMetadata}
            title="Partial Data Available"
          />
        )}

        {payload.summary && (
          <p className="text-[15px] leading-7 text-foreground/90">{payload.summary}</p>
        )}

        {/* Email chrome */}
        <div className="overflow-hidden rounded-xl border border-sky-100 bg-sky-50/40">
          {/* Meta rows */}
          <div className="divide-y divide-sky-100/60">
            {payload.audience && (
              <div className="flex gap-3 px-4 py-2.5">
                <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-sky-600">
                  To
                </span>
                <span className="text-[13px] text-foreground/88">{payload.audience}</span>
              </div>
            )}
            {payload.subject && (
              <div className="flex gap-3 px-4 py-2.5">
                <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-sky-600">
                  Subject
                </span>
                <span className="text-[13px] font-semibold text-foreground">{payload.subject}</span>
              </div>
            )}
          </div>

          {/* Email body */}
          {payload.body && (
            <div className="border-t border-sky-100/60 bg-white/60 px-4 py-4">
              <p className="whitespace-pre-wrap text-[14px] leading-7 text-foreground/88">
                {payload.body}
              </p>
            </div>
          )}
        </div>

        {/* Why this works */}
        {rationale.length > 0 && (
          <div>
            <SectionLabel>Why This Works</SectionLabel>
            <Chips items={rationale} tone="info" />
          </div>
        )}

        {/* Alternate angles */}
        {variants.length > 0 && (
          <div>
            <SectionLabel>Alternate Angles</SectionLabel>
            <Chips items={variants} />
          </div>
        )}

        <ConfidenceMeter confidence={payload.confidence} />
      </div>
    </CardShell>
  );
}
