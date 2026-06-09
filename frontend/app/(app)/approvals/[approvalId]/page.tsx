import { ApprovalDetailPage } from "@/components/app-shell/ApprovalDetailPage";

type ApprovalDetailRouteProps = {
  params: Promise<{
    approvalId: string;
  }>;
};

export default async function ApprovalDetailRoute({ params }: ApprovalDetailRouteProps) {
  const { approvalId } = await params;

  return <ApprovalDetailPage approvalId={approvalId} />;
}
