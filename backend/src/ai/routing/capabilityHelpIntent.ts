export function isCapabilityHelpQuery(input: string): boolean {
  const query = input.trim();
  if (!query) return false;

  const asksAboutHelp =
    /^(?:how\s+can\s+you\s+help|what\s+can\s+you\s+do|what\s+are\s+your\s+capabilit(?:y|ies)|explain\s+your\s+capabilit(?:y|ies))\b/i.test(query) ||
    /\b(?:tell\s+me\s+(?:about\s+)?your\s+capabilit(?:y|ies)|share\s+(?:about\s+)?your\s+capabilit(?:y|ies))\b/i.test(query);

  const asksAboutAutomationMeta =
    /^(?:how\s+(?:do|can)\s+(?:you|i)\s+(?:create|make|build|setup)\s+(?:a\s+)?(?:workflow|automation|alert))\b/i.test(query);

  // If the user explicitly asks to "setup", "create", "make", or "draft" a workflow, it is NOT a help query.
  const explicitlyCreating = /\b(?:setup|create|make|draft|build|run|execute)\s+(?:a\s+)?(?:workflow|automation|alert|recurring)\b/i.test(query);

  return (asksAboutHelp || asksAboutAutomationMeta) && !explicitlyCreating;
}
