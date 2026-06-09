"use client";

import type { PreCallBriefPayload } from "@/services/command";
import { CardShell, Chips, ConfidenceMeter, SectionLabel } from "./CardShell";
import { MissingDataState } from "./MissingDataState";

export function PreCallBriefCard({ payload }: { payload: PreCallBriefPayload }) {
  if (payload.status && payload.status !== "ready" && payload.status !== "success" && payload.status !== "partial") {
    return (
      <MissingDataState
        status={payload.status}
        searchMetadata={payload.searchMetadata}
        title="Pre-Call Brief Unavailable"
      />
    );
  }

  const suggestedQuestions = payload.suggestedQuestions ?? [];
  const successCriteria = payload.successCriteria ?? [];
  const openingLines = payload.openingLines ?? [];
  const likelyObjections = payload.likelyObjections ?? [];
  const source = payload.searchMetadata?.sourceUsed ?? null;

  return (
    <CardShell type="pre_call_brief" sourceLabel={source}>
      <div className="space-y-5">
        {payload.status === "partial" && payload.searchMetadata && (
          <MissingDataState
            status={payload.status}
            searchMetadata={payload.searchMetadata}
            title="Partial Data Available"
          />
        )}

        {/* Objective */}
        {payload.objective && (
          <div>
            <SectionLabel>Objective</SectionLabel>
            <p className="text-[15px] font-semibold tracking-tight text-foreground">
              {payload.objective}
            </p>
          </div>
        )}

        {/* Account context */}
        {payload.accountContext && (
          <p className="text-[14px] leading-6 text-foreground/86">{payload.accountContext}</p>
        )}

        {/* Opening lines — styled as quoted speech */}
        {openingLines.length > 0 && (
          <div>
            <SectionLabel>Opening Lines</SectionLabel>
            <div className="space-y-2">
              {openingLines.map((line, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-violet-100 bg-violet-50/50 px-4 py-2.5 text-[13px] italic leading-6 text-foreground/86 before:mr-1 before:text-violet-400 before:content-['\u201c'] after:ml-0.5 after:text-violet-400 after:content-['\u201d']"
                >
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Questions + Success criteria */}
        {(suggestedQuestions.length > 0 || successCriteria.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {suggestedQuestions.length > 0 && (
              <div>
                <SectionLabel>Suggested Questions</SectionLabel>
                <ol className="space-y-1.5 pl-4 text-[14px] leading-6 text-foreground/86 [list-style-type:decimal]">
                  {suggestedQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ol>
              </div>
            )}
            {successCriteria.length > 0 && (
              <div>
                <SectionLabel>Success Criteria</SectionLabel>
                <Chips items={successCriteria} tone="success" />
              </div>
            )}
          </div>
        )}

        {/* Likely objections */}
        {likelyObjections.length > 0 && (
          <div>
            <SectionLabel>Likely Objections</SectionLabel>
            <Chips items={likelyObjections} tone="warning" />
          </div>
        )}

        <ConfidenceMeter confidence={payload.confidence} />
      </div>
    </CardShell>
  );
}
