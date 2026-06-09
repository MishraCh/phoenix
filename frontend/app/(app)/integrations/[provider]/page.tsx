import { IntegrationDetailPage } from "@/components/app-shell/IntegrationDetailPage";

type IntegrationDetailRouteProps = {
  params: Promise<{
    provider: string;
  }>;
};

export default async function IntegrationDetailRoute({ params }: IntegrationDetailRouteProps) {
  const { provider } = await params;

  return <IntegrationDetailPage provider={provider} />;
}
