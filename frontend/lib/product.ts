export function deriveFirstName(displayName: string | null | undefined, email?: string | null) {
  const trimmedName = displayName?.trim();

  if (trimmedName) {
    return trimmedName.split(/\s+/)[0] ?? "My";
  }

  const emailName = email?.split("@")[0]?.replace(/[._-]+/g, " ").trim();

  if (emailName) {
    const firstPart = emailName.split(/\s+/)[0];

    if (firstPart) {
      return firstPart.charAt(0).toUpperCase() + firstPart.slice(1);
    }
  }

  return "My";
}

export function getDefaultWorkspaceName(displayName: string | null | undefined, email?: string | null) {
  const firstName = deriveFirstName(displayName, email);

  if (firstName === "My") {
    return "My Workspace";
  }

  return `${firstName}'s Workspace`;
}

export function getFriendlyErrorMessage(
  error: unknown,
  fallback = "Something needs attention. Please try again.",
) {
  const message = error instanceof Error ? error.message : "";
  const lower = message.toLowerCase();

  if (!message) {
    return fallback;
  }

  if (
    lower.includes("firebase") ||
    lower.includes("token") ||
    lower.includes("oauth") ||
    lower.includes("endpoint") ||
    lower.includes("request failed") ||
    lower.includes("auth/")
  ) {
    return fallback;
  }

  return message;
}
