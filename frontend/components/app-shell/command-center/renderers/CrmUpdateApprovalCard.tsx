"use client";

import { CheckCircle2, Loader2, ArrowRight, Save } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CrmUpdateApprovalCard({
  approval,
  messageId,
  defaultStatus,
  onEdit,
  onApprove,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  approval: any;
  messageId?: string;
  defaultStatus?: string;
  onEdit?: (approvalId: string) => void;
  onApprove?: (messageId: string, approvalId: string, options?: { retry?: boolean }) => void;
}) {
  const status = approval.status ?? defaultStatus;
  const isExecuted = status === "executed";
  const isExecuting = status === "executing";
  const isFailed = status === "failed";
  const isPendingOrEdited = status === "pending" || status === "edited";

  const preview = approval.preview ?? {};
  const beforeValues = preview.beforeValues ?? {};
  const updates = preview.updates ?? {};

  const isDealStage = Boolean(updates.dealstage);

  return (
    <div className="rounded-[1.25rem] border border-border/40 bg-secondary/40 p-5 mt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary/80 flex items-center gap-1.5">
            <Save className="size-3.5" />
            {isExecuted ? "Record updated" : isDealStage ? "Update Deal Stage" : "Update record"}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {approval.title || "CRM Update Approval"}
          </p>
          {!isExecuted ? (
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {approval.riskLevel} risk • Review changes before updating HubSpot.
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {isExecuted ? (
            <span className="rounded-full bg-emerald-100 px-4 py-1.5 text-xs font-semibold text-emerald-700">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" />
                Updated
              </span>
            </span>
          ) : isExecuting ? (
            <span className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-primary shadow-sm ring-1 ring-border/50 flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" />
              Saving...
            </span>
          ) : isFailed ? (
            <Button
              size="sm"
              className="h-8 rounded-full px-4"
              onClick={() => onApprove?.(messageId || "", approval.id, { retry: true })}
            >
              Retry save
            </Button>
          ) : isPendingOrEdited ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-full px-4 border-primary/20 hover:bg-white hover:text-primary transition-colors"
                onClick={() => onEdit?.(approval.id)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                className="h-8 rounded-full px-4 bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => onApprove?.(messageId || "", approval.id)}
              >
                Approve & Save
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {!isExecuted ? (
        <div className="mt-4 rounded-xl border border-border/50 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border/50 bg-secondary/30">
            <span className="text-sm font-semibold text-foreground">Proposed Changes</span>
          </div>
          <div className="divide-y divide-border/40">
            {Object.keys(updates).map((key) => {
              const beforeValue = String(beforeValues[key] ?? "—");
              const afterValue = String(updates[key]);
              return (
                <div key={key} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="w-1/3 text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">
                    {key}
                  </div>
                  <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm">
                    <span className="line-through opacity-60 bg-red-50 text-red-700 px-2 py-0.5 rounded break-all">
                      {beforeValue}
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground/60 shrink-0 hidden sm:block" />
                    <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded break-all">
                      {afterValue}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
