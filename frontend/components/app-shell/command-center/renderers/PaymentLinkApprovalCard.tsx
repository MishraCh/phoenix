"use client";

import { useState } from "react";
import { CheckCircle2, Copy, CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PaymentLinkApprovalCard({
  approval,
  messageId,
  defaultStatus,
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
  const [copied, setCopied] = useState(false);

  const preview = approval.preview ?? {};
  const productName = typeof preview.productName === "string" ? preview.productName : "Product";
  const amountUsd = typeof preview.amountUsd === "number" ? preview.amountUsd : null;
  const linkUrl =
    typeof approval.executionResult?.url === "string" ? (approval.executionResult.url as string) : null;

  async function handleCopy() {
    if (!linkUrl) return;
    await navigator.clipboard.writeText(linkUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-[1.25rem] border border-border/40 bg-secondary/40 p-5 mt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary/80 flex items-center gap-1.5">
            <CreditCard className="size-3.5" />
            {isExecuted ? "Payment link created" : "Create Stripe payment link"}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {productName}
            {amountUsd !== null ? ` — $${amountUsd}` : ""}
          </p>
          {!isExecuted ? (
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {approval.riskLevel} risk • The link is only created after you approve.
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {isExecuted ? (
            <span className="rounded-full bg-emerald-100 px-4 py-1.5 text-xs font-semibold text-emerald-700">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" />
                Created
              </span>
            </span>
          ) : isExecuting ? (
            <span className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-primary shadow-sm ring-1 ring-border/50 flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" />
              Creating…
            </span>
          ) : isFailed ? (
            <Button size="sm" className="h-8 rounded-full px-4" onClick={() => onApprove?.(messageId || "", approval.id, { retry: true })}>
              Retry
            </Button>
          ) : isPendingOrEdited ? (
            <Button
              size="sm"
              className="h-8 rounded-full px-4 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => onApprove?.(messageId || "", approval.id)}
            >
              Approve &amp; Create link
            </Button>
          ) : null}
        </div>
      </div>

      {isExecuted && linkUrl ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border/50 bg-white px-4 py-3 shadow-sm">
          <a
            href={linkUrl}
            target="_blank"
            rel="noreferrer"
            className="flex min-w-0 flex-1 items-center gap-1.5 truncate font-mono text-xs text-primary hover:underline"
          >
            <ExternalLink className="size-3.5 shrink-0" />
            <span className="truncate">{linkUrl}</span>
          </a>
          <Button variant="outline" size="sm" className="h-7 rounded-full px-3 text-xs" onClick={() => void handleCopy()}>
            <Copy className="mr-1 size-3" />
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
