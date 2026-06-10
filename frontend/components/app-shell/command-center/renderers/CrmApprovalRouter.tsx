"use client";

import { useApprovalDetailQuery } from "@/hooks/useGideonQueries";
import { Loader2 } from "lucide-react";
import { CrmTaskApprovalCard } from "./CrmTaskApprovalCard";
import { CrmNoteApprovalCard } from "./CrmNoteApprovalCard";
import { CrmUpdateApprovalCard } from "./CrmUpdateApprovalCard";
import { CrmBulkApprovalCard } from "./CrmBulkApprovalCard";
import { CrmCreateApprovalCard } from "./CrmCreateApprovalCard";
import { PaymentLinkApprovalCard } from "./PaymentLinkApprovalCard";

export function CrmApprovalRouter({
  approvalId,
  messageId,
  defaultStatus,
  onEdit,
  onApprove,
}: {
  approvalId: string;
  messageId?: string;
  defaultStatus?: string;
  onEdit?: (approvalId: string) => void;
  onApprove?: (messageId: string, approvalId: string, options?: { retry?: boolean }) => void;
}) {
  const { data: approval, isLoading } = useApprovalDetailQuery(approvalId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-4">
        <Loader2 className="size-4 animate-spin" />
        Loading CRM approval...
      </div>
    );
  }

  if (!approval || !approval.proposedAction?.actionType) {
    return null;
  }

  const { actionType } = approval.proposedAction;

  if (actionType === "hubspot_task_create" || actionType === "hubspot_task_update") {
    return <CrmTaskApprovalCard approval={approval} messageId={messageId} defaultStatus={defaultStatus} onEdit={onEdit} onApprove={onApprove} />;
  }

  if (actionType === "hubspot_note_create") {
    return <CrmNoteApprovalCard approval={approval} messageId={messageId} defaultStatus={defaultStatus} onEdit={onEdit} onApprove={onApprove} />;
  }

  if (actionType === "hubspot_update") {
    return <CrmUpdateApprovalCard approval={approval} messageId={messageId} defaultStatus={defaultStatus} onEdit={onEdit} onApprove={onApprove} />;
  }

  if (actionType === "hubspot_bulk_write") {
    return <CrmBulkApprovalCard approval={approval} messageId={messageId} defaultStatus={defaultStatus} onEdit={onEdit} onApprove={onApprove} />;
  }

  if (actionType === "stripe_payment_link") {
    return <PaymentLinkApprovalCard approval={approval} messageId={messageId} defaultStatus={defaultStatus} onEdit={onEdit} onApprove={onApprove} />;
  }

  if (actionType === "hubspot_create") {
    return <CrmCreateApprovalCard approval={approval} messageId={messageId} defaultStatus={defaultStatus} onEdit={onEdit} onApprove={onApprove} />;
  }

  // Any approval type without a dedicated card still gets Approve/Edit in chat.
  return (
    <CrmCreateApprovalCard
      approval={approval}
      messageId={messageId}
      defaultStatus={defaultStatus}
      onEdit={onEdit}
      onApprove={onApprove}
      headline="Approval required"
    />
  );
}
