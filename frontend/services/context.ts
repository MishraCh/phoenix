import { apiFetch } from "./apiClient";

export type ContextBundle = {
  id: string;
  key: string;
  purpose: string;
  freshness: "fresh" | "stale" | "partial" | "missing";
  missingSources: string[];
  sourceRefs: Array<{
    sourceType: string;
    sourceId: string;
    title: string | null;
    url: string | null;
    confidence: number | null;
  }>;
  inputHash: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export function fetchContextBundles(firebaseIdToken: string) {
  return apiFetch<{ bundles: ContextBundle[]; warnings: string[] }>("/context", {
    firebaseIdToken,
    method: "GET",
  });
}

export function buildContextBundle(firebaseIdToken: string) {
  return apiFetch<{ bundle: ContextBundle; reused: boolean }>("/context/bundles", {
    firebaseIdToken,
    method: "POST",
    body: JSON.stringify({
      key: "workspace:command_center",
      purpose: "Reusable command center context",
      sourceRefs: [],
      payload: { surface: "context_page" },
      ttlMinutes: 240,
    }),
  });
}
