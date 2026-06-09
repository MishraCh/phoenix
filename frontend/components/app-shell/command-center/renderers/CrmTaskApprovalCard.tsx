"use client";

import { CheckCircle2, Loader2, SquareCheckBig } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CrmTaskApprovalCard({
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

  const actionType = approval.proposedAction?.actionType;
  const isUpdate = actionType === "hubspot_task_update";
  
  const input = approval.proposedAction?.input ?? {};
  const subject = input.subject || "No subject";
  const body = input.body || "";
  const updates = input.updates || {};

  return (
    <div className="rounded-[1.25rem] border border-border/40 bg-secondary/40 p-5 mt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary/80 flex items-center gap-1.5">
            <SquareCheckBig className="size-3.5" />
            {isExecuted ? "Task created" : isUpdate ? "Update task" : "Create task"}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {approval.title || "CRM Task Approval"}
          </p>
          {!isExecuted ? (
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {approval.riskLevel} risk • Review task details before saving to HubSpot.
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {isExecuted ? (
            <span className="rounded-full bg-emerald-100 px-4 py-1.5 text-xs font-semibold text-emerald-700">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" />
                Completed
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
          {isUpdate ? (
            <div className="px-4 py-3 text-sm leading-relaxed text-foreground">
              <span className="font-semibold text-foreground">Updates:</span>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] text-muted-foreground bg-muted/30 p-2 rounded-lg border border-border/40">
                {JSON.stringify(updates, null, 2)}
              </pre>
            </div>
          ) : (
            <>
              <div className="border-b border-border/50 bg-secondary/30 px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">Subject:</span> {subject}
                </div>
              </div>
              <div className="px-4 py-4 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                {body || <span className="italic text-muted-foreground">No description provided.</span>}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
