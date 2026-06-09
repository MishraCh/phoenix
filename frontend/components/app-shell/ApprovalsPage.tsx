"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Pencil, X, Mail, FileText, Globe, GitBranch } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { StatusPill } from "@/components/ui/StatusPill";
import { useToast } from "@/components/ui/ToastProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { gideonQueryKeys, useApprovalsQuery } from "@/hooks/useGideonQueries";
import { getFriendlyErrorMessage } from "@/lib/product";
import {
  approveApproval,
  editApproval,
  fallbackApprovals,
  rejectApproval,
  type ApprovalListItem,
} from "@/services/approvals";

import { ProductHeader } from "./ProductHeader";
import { PageSection, SummaryRow } from "./ProductPrimitives";

export function ApprovalsPage() {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const { idToken } = useAuth();
  const approvalsQuery = useApprovalsQuery();
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingRiskId, setEditingRiskId] = useState<string | null>(null);
  const approvals = approvalsQuery.data?.approvals ?? fallbackApprovals;
  const loading = approvalsQuery.isLoading && !approvalsQuery.data;
  const error = actionError
    ?? (approvalsQuery.error
      ? getFriendlyErrorMessage(approvalsQuery.error, "We couldn't load the approval queue yet.")
      : null);
  const pendingCount = approvals.filter((approval) => approval.status === "pending" || approval.status === "edited").length;
  const highRiskCount = approvals.filter((approval) => approval.riskLevel === "high" || approval.riskLevel === "critical").length;
  const workflowLinkedCount = approvals.filter((approval) => Boolean(approval.workflowId)).length;

  async function updateApproval(approvalId: string, action: "approve" | "reject") {
    if (!idToken) {
      return;
    }

    try {
      const result =
        action === "approve"
          ? await approveApproval(idToken, approvalId)
          : await rejectApproval(idToken, approvalId, "Rejected from the approval queue.");

      queryClient.setQueryData(gideonQueryKeys.approvals(idToken), (current: typeof approvalsQuery.data) =>
        current
          ? {
              ...current,
              approvals: current.approvals.map((approval) =>
                approval.id === approvalId ? { ...approval, status: result.status } : approval,
              ),
            }
          : current,
      );

      setActionError(null);
      pushToast({
        title:
          result.status === "executed"
            ? "Approved and executed"
            : result.status === "approved"
              ? "Approved"
              : result.status === "failed"
                ? "Approval failed"
                : "Rejected",
        description:
          result.status === "failed"
            ? (result.error ?? "The approved action could not be completed.")
            : "The approval queue has been updated.",
        tone: result.status === "failed" ? "error" : "success",
      });
    } catch (nextError) {
      const message = getFriendlyErrorMessage(nextError, "We couldn't update that approval yet.");
      setActionError(message);
      pushToast({
        title: "Approval needs attention",
        description: message,
        tone: "error",
      });
    }
  }

  async function handleEditRisk(approval: ApprovalListItem, riskLevel: ApprovalListItem["riskLevel"]) {
    if (!idToken) return;
    setEditingRiskId(null);
    try {
      await editApproval(idToken, approval.id, { proposedAction: { riskLevel } });
      queryClient.setQueryData(gideonQueryKeys.approvals(idToken), (current: typeof approvalsQuery.data) =>
        current
          ? { ...current, approvals: current.approvals.map((a) => a.id === approval.id ? { ...a, riskLevel } : a) }
          : current,
      );
      pushToast({ title: "Risk level updated", description: `Changed to ${riskLevel}.`, tone: "success" });
    } catch (nextError) {
      pushToast({
        title: "Couldn't update risk level",
        description: getFriendlyErrorMessage(nextError, "Try again in a moment."),
        tone: "error",
      });
    }
  }

  return (
    <section className="space-y-6">
      <ProductHeader
        eyebrow="Approvals"
        title="Review actions before they run"
        description="Emails, updates, and other external actions pause here so you can confirm them before anything changes."
        meta={
          <SummaryRow
            className="mt-0 md:grid-cols-3 xl:grid-cols-3"
            items={[
              {
                label: "Awaiting review",
                value: pendingCount,
                detail: "Pending approvals and edited actions needing a decision.",
                icon: Check,
                tone: pendingCount > 0 ? "primary" : "neutral",
              },
              {
                label: "High risk",
                value: highRiskCount,
                detail: "Actions with higher impact that deserve careful review.",
                icon: AlertTriangle,
                tone: highRiskCount > 0 ? "warning" : "neutral",
              },
              {
                label: "Workflow linked",
                value: workflowLinkedCount,
                detail: "Approvals created as part of workflow execution.",
                icon: GitBranch,
                tone: workflowLinkedCount > 0 ? "success" : "neutral",
              },
            ]}
          />
        }
      />

      {error ? <ErrorState message={error} onRetry={() => void approvalsQuery.refetch()} /> : null}

      <PageSection
        title="Approval queue"
        description="Read the intent, risk, and status first, then decide whether to approve, edit, or reject."
        contentClassName="mt-0"
        className="p-0"
      >
        <Card className="overflow-hidden rounded-none border-0 bg-transparent shadow-none">
          <CardContent className="p-0">
          <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-border px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span>Action</span>
            <span>Risk</span>
            <span>Status</span>
          </div>
          {loading ? (
            <div className="p-5">
              <LoadingState label="Loading approvals..." rows={3} />
            </div>
          ) : approvals.length > 0 ? (
            <div className="divide-y divide-border">
              {approvals.map((approval) => {
                const isEmail = approval.title.toLowerCase().includes("email") || approval.description.toLowerCase().includes("email");
                const isDoc = approval.title.toLowerCase().includes("draft") || approval.description.toLowerCase().includes("document");
                const ApprovalIcon = isEmail ? Mail : isDoc ? FileText : Globe;

                const riskBorderClass = {
                  low: "border-l-[3px] border-l-[hsl(var(--badge-success-text))]",
                  medium: "border-l-[3px] border-l-[hsl(var(--badge-warning-border))]",
                  high: "border-l-[3px] border-l-destructive/80",
                  critical: "border-l-[3px] border-l-destructive",
                }[approval.riskLevel] ?? "";

                const iconClass = isEmail
                  ? "bg-[hsl(var(--badge-running-bg))] text-primary ring-1 ring-primary/20"
                  : isDoc
                  ? "bg-[#F5F0FF] text-purple-600 ring-1 ring-purple-200"
                  : "bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))] ring-1 ring-[hsl(var(--badge-warning-border))]";

                return (
                  <article key={approval.id} className={`grid gap-4 px-5 py-5 transition-colors hover:bg-background/70 xl:grid-cols-[1fr_8rem_8rem_14rem] items-center ${riskBorderClass}`}>
                    <div className="flex items-start gap-4">
                      <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${iconClass}`}>
                        <ApprovalIcon className="size-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold">{approval.title}</h3>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">{approval.description}</p>
                        {approval.workflowId ? (
                          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200">
                            <GitBranch className="size-3" />
                            Workflow
                          </span>
                        ) : null}
                      </div>
                    </div>
                  <RiskBadge riskLevel={approval.riskLevel} />
                  <StatusPill status={approval.status} />
                  <div className="flex flex-wrap gap-2">
                    {(approval.status === "pending" || approval.status === "edited") && editingRiskId === approval.id ? (
                      <select
                        autoFocus
                        defaultValue={approval.riskLevel}
                        onBlur={() => setEditingRiskId(null)}
                        onChange={(e) => void handleEditRisk(approval, e.target.value as ApprovalListItem["riskLevel"])}
                        className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    ) : (approval.status === "pending" || approval.status === "edited") ? (
                      <Button size="sm" variant="ghost" onClick={() => setEditingRiskId(approval.id)}>
                        <Pencil className="mr-1 size-3" />
                        Edit risk
                      </Button>
                    ) : null}
                    {(approval.status === "pending" || approval.status === "edited") ? (
                      <>
                        <Button
                          size="sm"
                          className="bg-[#00925A] text-white hover:bg-[#007A4C] border-0"
                          onClick={() => updateApproval(approval.id, "approve")}
                        >
                          <Check className="mr-1 size-3" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-[#FFBDBD] text-[#CC2222] hover:bg-[#FFF0F0] hover:border-[#FF9999]"
                          onClick={() => updateApproval(approval.id, "reject")}
                        >
                          <X className="mr-1 size-3" />
                          Reject
                        </Button>
                      </>
                    ) : null}
                  </div>
                </article>
                );
              })}
            </div>
          ) : (
            <div className="p-5">
              <EmptyState
                icon={<AlertTriangle className="size-6" />}
                title="No approvals waiting"
                description="When Gideon reaches an action that needs sign-off, it will appear here with the right context."
              />
            </div>
          )}
          </CardContent>
        </Card>
      </PageSection>
    </section>
  );
}
