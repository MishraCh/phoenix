"use client";

import { useApprovalDetailQuery } from "@/hooks/useGideonQueries";
import { CheckCircle2, Loader2, Mail, Network, NotebookPen, SquareCheckBig } from "lucide-react";
import { Button } from "@/components/ui/button";

type LiveApprovalCardProps = {
  approvalId: string;
  messageId: string;
  defaultLabel: string;
  defaultRiskLevel: string;
  defaultStatus: string;
  onEdit: (approvalId: string) => void;
  onApprove: (messageId: string, approvalId: string, options?: { retry?: boolean }) => void;
};

type ApprovalLike = {
  title?: string;
  type?: string;
  status?: string;
  riskLevel?: string;
  preview?: Record<string, unknown>;
  proposedAction?: {
    toolName?: string;
    input?: Record<string, unknown>;
  };
};

function actionLabels(approval: ApprovalLike | null, fallbackLabel: string) {
  const toolName = approval?.proposedAction?.toolName ?? "";
  const inferredLabel = `${approval?.title ?? ""} ${fallbackLabel}`.toLowerCase();
  const isEmail =
    approval?.type === "email_send" ||
    toolName.startsWith("gmail.") ||
    inferredLabel.includes("send gmail email") ||
    inferredLabel.includes("gmail send");
  const isTask = toolName.includes("Task") || approval?.type === "task_create";
  const isNote = toolName.includes("Note");
  const isAssociation = toolName.includes("Association");

  return {
    badge: isEmail ? "Email approval" : isTask ? "Task approval" : isNote ? "Note approval" : isAssociation ? "Association approval" : "Approval ready",
    execute: isEmail ? "Approve & send" : "Approve action",
    retry: isEmail ? "Retry send" : "Retry action",
    executing: isEmail ? "Sending…" : "Executing…",
    executed: isEmail ? "Sent" : "Completed",
    helper: isEmail
      ? "Review the message, then approve to send it externally."
      : `Review ${approval?.title || fallbackLabel}, then approve to execute the external action.`,
  };
}

function PreviewIcon({ approval }: { approval: ApprovalLike }) {
  const toolName = approval.proposedAction?.toolName ?? "";
  if (approval.type === "email_send" || toolName.startsWith("gmail.")) return <Mail className="size-4 text-primary" />;
  if (toolName.includes("Task")) return <SquareCheckBig className="size-4 text-primary" />;
  if (toolName.includes("Note")) return <NotebookPen className="size-4 text-primary" />;
  return <Network className="size-4 text-primary" />;
}

function ApprovalPreview({ approval }: { approval: ApprovalLike }) {
  const preview = approval.preview ?? {};
  const input = approval.proposedAction?.input ?? {};
  const toolName = approval.proposedAction?.toolName ?? "";
  const isEmail =
    approval.type === "email_send" ||
    toolName === "gmail.prepareSendApproval" ||
    toolName === "gmail.sendApproved";

  if (isEmail) {
    const subject = (preview.subject as string) || (input.subject as string) || "No subject";
    const body = (preview.body as string) || (input.body as string) || "Empty body";
    const to = (preview.to as string | string[]) || (input.to as string | string[]) || [];
    const toDisplay = Array.isArray(to) ? to.join(", ") : to;

    return (
      <div className="mt-4 rounded-xl border border-border/50 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-border/50 bg-secondary/30 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <span className="font-semibold text-foreground">To:</span> {toDisplay || "Not specified"}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Subject:</span> {subject}
          </div>
        </div>
        <div className="px-4 py-4 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
          {body}
        </div>
      </div>
    );
  }

  const entries = Object.entries(preview).filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (!entries.length) {
    return null;
  }

  return (
    <div className="mt-4 rounded-xl border border-border/50 bg-white px-4 py-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <PreviewIcon approval={approval} />
        Action preview
      </div>
      <div className="space-y-2">
        {entries.map(([key, value]) => (
          <div key={key} className="grid gap-1 md:grid-cols-[150px_minmax(0,1fr)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{key}</p>
            <p className="text-sm text-foreground break-words whitespace-pre-wrap">
              {typeof value === "string" ? value : JSON.stringify(value)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LiveApprovalCard({
  approvalId,
  messageId,
  defaultLabel,
  defaultRiskLevel,
  defaultStatus,
  onEdit,
  onApprove,
}: LiveApprovalCardProps) {
  const { data: approval, isLoading } = useApprovalDetailQuery(approvalId);

  const status = approval?.status ?? defaultStatus;
  const isExecuted = status === "executed";
  const isExecuting = status === "executing";
  const isFailed = status === "failed";
  const isPendingOrEdited = status === "pending" || status === "edited";
  const labels = actionLabels((approval ?? null) as ApprovalLike | null, defaultLabel);

  return (
    <div className="rounded-[1.25rem] border border-border/40 bg-secondary/40 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary/80">
            {isExecuted ? "Action executed" : labels.badge}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {approval?.title || defaultLabel}
          </p>
          {!isExecuted ? (
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {(approval?.riskLevel || defaultRiskLevel)} risk • {labels.helper}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {isExecuted ? (
            <span className="rounded-full bg-emerald-100 px-4 py-1.5 text-xs font-semibold text-emerald-700">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" />
                {labels.executed}
              </span>
            </span>
          ) : isExecuting ? (
            <span className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-primary shadow-sm ring-1 ring-border/50">
              {labels.executing}
            </span>
          ) : isFailed ? (
            <Button
              size="sm"
              className="h-8 rounded-full px-4"
              onClick={() => onApprove(messageId, approvalId, { retry: true })}
            >
              {labels.retry}
            </Button>
          ) : isPendingOrEdited ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-full px-4 border-primary/20 hover:bg-white hover:text-primary transition-colors"
                onClick={() => onEdit(approvalId)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                className="h-8 rounded-full px-4 bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => onApprove(messageId, approvalId)}
              >
                {labels.execute}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {!isExecuted && approval ? <ApprovalPreview approval={approval as ApprovalLike} /> : null}

      {!isExecuted && isLoading && !approval ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-border/50 bg-white p-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading preview...
        </div>
      ) : null}
    </div>
  );
}
