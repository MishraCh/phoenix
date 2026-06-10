"use client";

import { CheckCircle2, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

function flattenPreview(preview: Record<string, unknown>): Array<[string, string]> {
  const source =
    preview.properties && typeof preview.properties === "object" && !Array.isArray(preview.properties)
      ? (preview.properties as Record<string, unknown>)
      : preview;
  return Object.entries(source)
    .filter(([key, value]) => !["module", "recordId", "rows"].includes(key) && value != null && typeof value !== "object")
    .map(([key, value]) => [key, String(value)]);
}

/** Approval card for CRM record creation — also the generic fallback for
 *  approval types without a dedicated card (renders flat preview fields). */
export function CrmCreateApprovalCard({
  approval,
  messageId,
  defaultStatus,
  onEdit,
  onApprove,
  headline,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  approval: any;
  messageId?: string;
  defaultStatus?: string;
  onEdit?: (approvalId: string) => void;
  onApprove?: (messageId: string, approvalId: string, options?: { retry?: boolean }) => void;
  headline?: string;
}) {
  const status = approval.status ?? defaultStatus;
  const isExecuted = status === "executed";
  // "approved" is the transient moment between approve and execution finishing.
  const isExecuting = status === "executing" || status === "approved";
  const isFailed = status === "failed";
  const isPendingOrEdited = status === "pending" || status === "edited";

  const preview = (approval.preview ?? {}) as Record<string, unknown>;
  const moduleLabel = typeof preview.module === "string" ? preview.module.replace(/s$/, "") : "record";
  const fields = flattenPreview(preview);

  return (
    <div className="rounded-[1.25rem] border border-border/40 bg-secondary/40 p-5 mt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary/80 flex items-center gap-1.5">
            <UserPlus className="size-3.5" />
            {isExecuted ? "Created" : headline ?? `Create ${moduleLabel}`}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">{approval.title || "Approval required"}</p>
          {!isExecuted ? (
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {approval.riskLevel} risk • Review before Gideon writes externally.
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {isExecuted ? (
            <span className="rounded-full bg-emerald-100 px-4 py-1.5 text-xs font-semibold text-emerald-700">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" />
                Done
              </span>
            </span>
          ) : isExecuting ? (
            <span className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-primary shadow-sm ring-1 ring-border/50 flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" />
              Working…
            </span>
          ) : isFailed ? (
            <Button size="sm" className="h-8 rounded-full px-4" onClick={() => onApprove?.(messageId || "", approval.id, { retry: true })}>
              Retry
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
                Approve
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {!isExecuted && fields.length ? (
        <div className="mt-4 rounded-xl border border-border/50 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border/50 bg-secondary/30">
            <span className="text-sm font-semibold text-foreground">Details</span>
          </div>
          <div className="divide-y divide-border/40">
            {fields.map(([key, value]) => (
              <div key={key} className="px-4 py-2.5 flex flex-col gap-1 sm:flex-row sm:items-center">
                <div className="w-1/3 text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">{key}</div>
                <div className="flex-1 text-sm text-foreground break-words">{value}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
