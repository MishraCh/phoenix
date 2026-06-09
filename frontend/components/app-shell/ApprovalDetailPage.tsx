"use client";

import Link from "next/link";
import { ArrowLeft, CheckSquare, GitBranch, Globe, Sparkles } from "lucide-react";

import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/button";
import { useApprovalDetailQuery } from "@/hooks/useGideonQueries";
import { getFriendlyErrorMessage } from "@/lib/product";
import { fallbackApprovals, type ApprovalListItem } from "@/services/approvals";

import { ProductHeader } from "./ProductHeader";
import { PageSection, SummaryRow } from "./ProductPrimitives";

type ApprovalDetailPageProps = {
  approvalId: string;
};

type ApprovalDetail = ApprovalListItem & {
  type?: string;
  reason?: string;
  preview?: Record<string, unknown>;
  sourceRefs?: Array<Record<string, unknown>>;
  approvedBy?: string | null;
  approvedAt?: string | null;
  executedAt?: string | null;
  error?: string | null;
};

export function ApprovalDetailPage({ approvalId }: ApprovalDetailPageProps) {
  const approvalQuery = useApprovalDetailQuery(approvalId);
  const approval =
    (approvalQuery.data as ApprovalDetail | undefined) ??
    (fallbackApprovals.find((item) => item.id === approvalId) ?? fallbackApprovals[0]);
  const loading = approvalQuery.isLoading && !approvalQuery.data;
  const error = approvalQuery.error
    ? getFriendlyErrorMessage(approvalQuery.error, "We couldn't open that approval yet.")
    : null;

  if (loading) {
    return <LoadingState label="Loading approval..." rows={3} />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => void approvalQuery.refetch()} />;
  }

  const approvalDetail = approval as ApprovalDetail;
  const sourceCount = approvalDetail.sourceRefs?.length ?? 0;

  return (
    <section className="space-y-6">
      <Button asChild variant="ghost" className="px-0 text-muted-foreground hover:bg-transparent">
        <Link href="/approvals">
          <ArrowLeft className="mr-2 size-4" />
          Back to approvals
        </Link>
      </Button>

      <ProductHeader
        eyebrow="Approval detail"
        title={approval.title ?? "Approval"}
          description={
          approvalDetail.description ??
          "Review the action, the risk, and the supporting context before deciding whether it should move forward."
        }
        meta={
          <SummaryRow
            className="md:grid-cols-2 xl:grid-cols-4"
            items={[
              {
                label: "Risk",
                value: approval.riskLevel,
                detail: "Impact classification used to route review and execution safety.",
                icon: Sparkles,
                tone:
                  approval.riskLevel === "high" || approval.riskLevel === "critical"
                    ? "warning"
                    : approval.riskLevel === "medium"
                      ? "primary"
                      : "success",
              },
              {
                label: "Status",
                value: approval.status,
                detail: "Where this action currently sits in the approval lifecycle.",
                icon: CheckSquare,
                tone:
                  approval.status === "approved" || approval.status === "executed"
                    ? "success"
                    : approval.status === "rejected" || approval.status === "failed"
                      ? "warning"
                      : "neutral",
              },
              {
                label: "Workflow linked",
                value: approval.workflowId ? "Yes" : "No",
                detail: approval.workflowId
                  ? "This decision was produced inside a workflow run."
                  : "This decision came from a direct Gideon action or command.",
                icon: GitBranch,
                tone: approval.workflowId ? "primary" : "neutral",
              },
              {
                label: "Sources",
                value: sourceCount,
                detail: "Supporting references attached to this approval payload.",
                icon: Globe,
                tone: sourceCount > 0 ? "success" : "neutral",
              },
            ]}
          />
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.85fr]">
        <PageSection
          title="Decision context"
          description="The human-readable reason for this action and the exact payload Gideon is asking to send or execute."
        >
          <div className="space-y-4">
            <div className="rounded-[1.25rem] border border-border/70 bg-background/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Why this exists
              </p>
              <p className="mt-3 text-sm leading-7 text-foreground">
                {approvalDetail.reason ?? approval.description}
              </p>
            </div>

            <div className="rounded-[1.25rem] border border-border/70 bg-background/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Proposed action
              </p>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {JSON.stringify(approval.proposedAction ?? {}, null, 2)}
              </pre>
            </div>

            {approvalDetail.preview ? (
              <div className="rounded-[1.25rem] border border-border/70 bg-background/70 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Preview
                </p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {JSON.stringify(approvalDetail.preview, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        </PageSection>

        <PageSection
          title="Review state"
          description="The current status, workflow linkage, and decision metadata that explain how this item should be handled."
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-[1.15rem] border border-border/70 bg-background/70 px-4 py-3">
              <span className="text-sm font-medium text-foreground">Risk level</span>
              <RiskBadge riskLevel={approval.riskLevel ?? "medium"} />
            </div>

            <div className="flex items-center justify-between rounded-[1.15rem] border border-border/70 bg-background/70 px-4 py-3">
              <span className="text-sm font-medium text-foreground">Approval status</span>
              <StatusPill status={approval.status ?? "pending"} />
            </div>

            <div className="rounded-[1.15rem] border border-border/70 bg-background/70 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Tool name
              </p>
              <p className="mt-2 text-sm text-foreground">
                {String(approval.proposedAction?.toolName ?? approvalDetail.type ?? "Pending review")}
              </p>
            </div>

            <div className="rounded-[1.15rem] border border-border/70 bg-background/70 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Workflow references
              </p>
              <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                <p>Workflow: {approval.workflowId ?? "Direct action"}</p>
                <p>Run: {approval.workflowRunId ?? "Not attached"}</p>
              </div>
            </div>

            {(approvalDetail.approvedAt || approvalDetail.executedAt || approvalDetail.error) ? (
              <div className="rounded-[1.15rem] border border-border/70 bg-background/70 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Execution notes
                </p>
                <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {approvalDetail.approvedAt ? <p>Approved at: {new Date(approvalDetail.approvedAt).toLocaleString()}</p> : null}
                  {approvalDetail.executedAt ? <p>Executed at: {new Date(approvalDetail.executedAt).toLocaleString()}</p> : null}
                  {approvalDetail.error ? <p className="text-rose-600">Error: {approvalDetail.error}</p> : null}
                </div>
              </div>
            ) : null}
          </div>
        </PageSection>
      </div>
    </section>
  );
}
