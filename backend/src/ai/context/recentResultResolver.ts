import type { SessionStateSnapshot } from "../contracts/sessionState.js";

export type SessionResultProjection = SessionStateSnapshot["recentResults"][number];

const PRIOR_RESULT_REFERENCE_PATTERNS = [
  /\b(?:the|that|your|provided|previous|above|earlier|last)\s+(?:list|result|results|table|answer|response|research)\b/i,
  /\b(?:those|these)\s+(?:companies|startups|contacts|deals|items|results|options|records|sources)\b/i,
  /\b(?:each|all|any|some|which|one)\s+of\s+(?:those|these|them)\b/i,
  /\b(?:them|those|these)\b/i,
  /\b(?:listed|shared|mentioned|provided|shown)\s+(?:above|earlier|previously)\b/i,
  /\bfrom\s+(?:the|that|your|provided|previous|above)\s+list\b/i,
  /\b(?:make|change|update|edit|add|remove|replace)\s+(?:it|the\s+workflow|the\s+draft)\b/i,
];

const RESEARCH_ENRICHMENT_PATTERN =
  /\b(detail|details|highest|lowest|valu(?:e|ed|ation)|worth|current|latest|recent|verify|fact[- ]?check|compare|rank|revenue|funding|raised|investor|founder|headcount|pricing|market cap|website)\b/i;

function semanticResultKind(result: SessionResultProjection): string {
  const payloadKind = result.compactPayload["kind"];
  return typeof payloadKind === "string" ? payloadKind : result.resultKind;
}

function hasUsefulPayload(result: SessionResultProjection): boolean {
  return (
    Object.keys(result.compactPayload).length > 0 ||
    result.sourceRefs.length > 0 ||
    Boolean(result.title)
  );
}

export function referencesRecentResult(query: string): boolean {
  return PRIOR_RESULT_REFERENCE_PATTERNS.some((pattern) => pattern.test(query));
}

export function resolveReferencedRecentResult(
  query: string,
  sessionState: SessionStateSnapshot | null | undefined,
): SessionResultProjection | null {
  if (!sessionState || !referencesRecentResult(query)) return null;

  return (
    [...sessionState.recentResults]
      .reverse()
      .find(
        (result) =>
          result.resultKind !== "clarification" &&
          result.resultKind !== "error" &&
          hasUsefulPayload(result),
      ) ?? null
  );
}

export function isResearchResult(result: SessionResultProjection): boolean {
  const kind = semanticResultKind(result);
  return kind === "search" || kind === "research";
}

export function shouldEnrichResearchFollowUp(
  query: string,
  result: SessionResultProjection,
): boolean {
  return isResearchResult(result) && RESEARCH_ENRICHMENT_PATTERN.test(query);
}

export function formatRecentResultForPrompt(
  result: SessionResultProjection,
  fallbackContext = "",
): string {
  const payload = result.compactPayload;
  const summary =
    typeof payload["summary"] === "string"
      ? payload["summary"]
      : typeof payload["answer"] === "string"
        ? payload["answer"]
        : "";
  const hasStructuredDetails =
    summary.length > 0 ||
    (Array.isArray(payload["records"]) && payload["records"].length > 0) ||
    (Array.isArray(payload["sections"]) && payload["sections"].length > 0) ||
    (Array.isArray(payload["candidates"]) && payload["candidates"].length > 0);
  const payloadText = JSON.stringify(payload, null, 2);
  const usefulPayload = hasStructuredDetails ? payloadText : fallbackContext;
  const boundedPayload = usefulPayload.slice(0, 8_000);

  return [
    "=== REFERENCED PRIOR RESULT ===",
    `Result kind: ${semanticResultKind(result)}`,
    result.title ? `Title: ${result.title}` : "",
    boundedPayload || "The prior result payload is unavailable; use the bounded session transcript below.",
    !usefulPayload && fallbackContext ? fallbackContext.slice(0, 6_000) : "",
    result.sourceRefs.length
      ? `Sources: ${result.sourceRefs
          .slice(0, 12)
          .map((source) => source.title || source.url || source.sourceId)
          .join("; ")}`
      : "",
    "=== END REFERENCED PRIOR RESULT ===",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildResearchFollowUpPrompt(
  query: string,
  result: SessionResultProjection,
  fallbackContext = "",
): string {
  return [
    "Continue the user's prior research using the exact prior result below.",
    "Do not ask which list they mean. Preserve the listed entities and research only the requested additional facts.",
    `Follow-up request: ${query}`,
    formatRecentResultForPrompt(result, fallbackContext),
  ].join("\n\n");
}
