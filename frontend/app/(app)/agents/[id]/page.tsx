import { AgentDetailPage } from "@/components/app-shell/AgentDetailPage";

type AgentDetailRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function AgentDetailRoute({ params }: AgentDetailRouteProps) {
  const { id } = await params;
  return <AgentDetailPage agentId={id} />;
}
