/**
 * Utility for scrubbing known hallucinated tokens or internal citation markers 
 * from AI-generated outputs before they enter the system pipeline.
 */
export function sanitizeAiOutput<T>(payload: T): T {
  if (typeof payload === "string") {
    // Strip the specific citation format: 🗯️cite⭐...🔃
    return payload.replace(/\s*🗯️cite⭐.*?🔃/g, "") as unknown as T;
  }

  if (Array.isArray(payload)) {
    return payload.map(sanitizeAiOutput) as unknown as T;
  }

  if (payload !== null && typeof payload === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      cleaned[key] = sanitizeAiOutput(value);
    }
    return cleaned as unknown as T;
  }

  return payload;
}
