"use client";

import { BookOpen, FileText, Hash, Link2 } from "lucide-react";

import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { useArtifactDetailQuery } from "@/hooks/useGideonQueries";
import { getFriendlyErrorMessage } from "@/lib/product";
import { fallbackArtifacts, type ArtifactDetail } from "@/services/artifacts";

import { ProductHeader } from "./ProductHeader";
import { PageSection, SummaryRow } from "./ProductPrimitives";

type ArtifactDetailPageProps = {
  artifactId: string;
};

const fallbackArtifactDetail: ArtifactDetail = {
  ...fallbackArtifacts[0],
  status: "saved",
  content: fallbackArtifacts[0].summary ?? "",
  sourceRefs: [],
  inputHash: "saved-output",
  sourceHashes: [],
  updatedAt: fallbackArtifacts[0].createdAt,
};

export function ArtifactDetailPage({ artifactId }: ArtifactDetailPageProps) {
  const artifactQuery = useArtifactDetailQuery(artifactId);
  const artifact = artifactQuery.data ?? fallbackArtifactDetail;
  const loading = artifactQuery.isLoading && !artifactQuery.data;
  const error = artifactQuery.error
    ? getFriendlyErrorMessage(artifactQuery.error, "We couldn't open that output yet.")
    : null;

  if (loading) {
    return <LoadingState label="Loading saved output..." rows={3} />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => void artifactQuery.refetch()} />;
  }

  const wordCount = artifact.content.trim().split(/\s+/).filter(Boolean).length;

  return (
    <section className="space-y-6">
      <ProductHeader
        eyebrow={artifact.artifactType}
        title={artifact.title}
        description="Review the saved output, its supporting references, and the metadata Gideon retained with it."
        meta={
          <SummaryRow
            className="md:grid-cols-2 xl:grid-cols-4"
            items={[
              {
                label: "Status",
                value: artifact.status,
                detail: "Persistence state for this saved workspace output.",
                icon: BookOpen,
                tone: artifact.status === "saved" ? "success" : "neutral",
              },
              {
                label: "Words",
                value: wordCount,
                detail: "Approximate size of the saved content body.",
                icon: FileText,
                tone: "primary",
              },
              {
                label: "Sources",
                value: artifact.sourceRefs.length,
                detail: "References or supporting links attached to the artifact.",
                icon: Link2,
                tone: artifact.sourceRefs.length > 0 ? "success" : "neutral",
              },
              {
                label: "Source hashes",
                value: artifact.sourceHashes.length,
                detail: "Stored content fingerprints for reuse and de-duplication.",
                icon: Hash,
                tone: artifact.sourceHashes.length > 0 ? "warning" : "neutral",
              },
            ]}
          />
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.85fr]">
        <PageSection
          title="Saved content"
          description="The preserved output body exactly as Gideon stored it in the workspace library."
        >
          <div className="rounded-[1.35rem] border border-border/70 bg-background/70 px-5 py-4">
            <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">{artifact.content}</p>
          </div>
        </PageSection>

        <PageSection
          title="Artifact metadata"
          description="Timing, provenance, and reference data attached to this saved output."
        >
          <div className="space-y-3">
            <div className="rounded-[1.15rem] border border-border/70 bg-background/70 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Updated
              </p>
              <p className="mt-2 text-sm text-foreground">{new Date(artifact.updatedAt).toLocaleString()}</p>
            </div>

            <div className="rounded-[1.15rem] border border-border/70 bg-background/70 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Reference hash
              </p>
              <p className="mt-2 break-all text-sm text-muted-foreground">
                {artifact.inputHash ?? "Saved output"}
              </p>
            </div>

            <div className="rounded-[1.15rem] border border-border/70 bg-background/70 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Source references
              </p>
              {artifact.sourceRefs.length > 0 ? (
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {JSON.stringify(artifact.sourceRefs, null, 2)}
                </pre>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No explicit references were stored with this output.
                </p>
              )}
            </div>
          </div>
        </PageSection>
      </div>
    </section>
  );
}
