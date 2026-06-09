import { ArtifactDetailPage } from "@/components/app-shell/ArtifactDetailPage";

type ArtifactDetailRouteProps = {
  params: Promise<{
    artifactId: string;
  }>;
};

export default async function ArtifactDetailRoute({ params }: ArtifactDetailRouteProps) {
  const { artifactId } = await params;

  return <ArtifactDetailPage artifactId={artifactId} />;
}
