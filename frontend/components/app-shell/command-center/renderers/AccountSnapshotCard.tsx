import { CalloutBlock, CardShell, Chips, ConfidenceMeter, SectionLabel } from "./CardShell";
import { MissingDataState } from "./MissingDataState";
import type { CommandExpertResult, AccountSnapshotPayload } from "@/services/command";

export function AccountSnapshotCard({ payload }: { payload: AccountSnapshotPayload }) {

  if (payload?.status && payload.status !== "ready" && payload.status !== "success" && payload.status !== "partial") {
    return (
      <MissingDataState
        status={payload.status}
        searchMetadata={payload.searchMetadata}
        title="Account Snapshot Unavailable"
      />
    );
  }

  const source = payload?.searchMetadata?.sourceUsed ?? null;

  return (
    <CardShell type="account_snapshot" sourceLabel={source}>
      <div className="space-y-5">
        {payload?.summary && (
          <p className="text-[14px] leading-6 text-foreground/90">{payload.summary}</p>
        )}

        <div className="grid grid-cols-2 gap-4 rounded-xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-4">
          {payload?.crmHealth && (
            <div>
              <SectionLabel>CRM Health</SectionLabel>
              <div className="mt-1 flex items-center gap-2">
                <span className={`size-2 shrink-0 rounded-full ${
                  payload.crmHealth === "healthy" ? "bg-emerald-500" :
                  payload.crmHealth === "at_risk" ? "bg-rose-500" :
                  payload.crmHealth === "churned" ? "bg-slate-500" : "bg-amber-500"
                }`} />
                <span className="text-[13px] font-medium text-foreground capitalize">
                  {payload.crmHealth.replace("_", " ")}
                </span>
              </div>
            </div>
          )}
          {payload?.dealStage && (
            <div>
              <SectionLabel>Stage</SectionLabel>
              <p className="text-[13px] font-medium text-foreground">{payload.dealStage}</p>
            </div>
          )}
          {payload?.owner && (
            <div>
              <SectionLabel>Owner</SectionLabel>
              <p className="text-[13px] font-medium text-foreground">{payload.owner}</p>
            </div>
          )}
          {payload?.lastActivity && (
            <div>
              <SectionLabel>Last Activity</SectionLabel>
              <p className="text-[13px] font-medium text-foreground">{payload.lastActivity}</p>
            </div>
          )}
        </div>

        {payload?.openTasks && payload.openTasks.length > 0 && (
          <div>
            <SectionLabel>Open Tasks</SectionLabel>
            <ul className="space-y-1.5 pl-5 text-[13px] leading-relaxed text-foreground/90 [list-style-type:disc]">
              {payload.openTasks.map((task, i) => (
                <li key={i}>{task}</li>
              ))}
            </ul>
          </div>
        )}

        <ConfidenceMeter confidence={payload?.confidence} />
      </div>
    </CardShell>
  );
}
