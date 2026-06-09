import { apiFetch } from "./apiClient";

export type ArtifactListItem = {
  id: string;
  title: string;
  artifactType: string;
  summary: string | null;
  createdAt: string;
};

export type ArtifactDetail = ArtifactListItem & {
  status: string;
  content: string;
  sourceRefs: Array<Record<string, unknown>>;
  inputHash: string | null;
  sourceHashes: string[];
  updatedAt: string;
};

export const fallbackArtifacts: ArtifactListItem[] = [
  {
    id: "sample-artifact",
    title: "Sample command output",
    artifactType: "summary",
    summary: "Saved reports, drafts, and summaries will appear here with source references.",
    createdAt: new Date().toISOString(),
  },
];

export function fetchArtifacts(firebaseIdToken: string) {
  return apiFetch<{ artifacts: ArtifactListItem[] }>("/artifacts?limit=25", {
    firebaseIdToken,
    method: "GET",
  });
}

export function fetchArtifact(firebaseIdToken: string, artifactId: string) {
  return apiFetch<ArtifactDetail>(`/artifacts/${artifactId}`, {
    firebaseIdToken,
    method: "GET",
  });
}

export function createArtifact(
  firebaseIdToken: string,
  input: {
    title: string;
    artifactType: "report" | "draft" | "summary" | "data" | "document";
    content: string;
    sourceRefs?: Array<Record<string, unknown>>;
    inputHash?: string;
  },
) {
  return apiFetch<{ artifactId: string }>("/artifacts", {
    firebaseIdToken,
    method: "POST",
    body: JSON.stringify({
      sourceRefs: [],
      ...input,
    }),
  });
}
