import { describe, it, expect } from "vitest";
import { getFriendlyErrorMessage } from "../lib/product.js";

describe("getFriendlyErrorMessage", () => {
  it("returns fallback for null input", () => {
    const result = getFriendlyErrorMessage(null);
    expect(result).toBe("Something needs attention. Please try again.");
  });

  it("returns fallback for undefined input", () => {
    expect(getFriendlyErrorMessage(undefined)).toBe("Something needs attention. Please try again.");
  });

  it("accepts a custom fallback", () => {
    expect(getFriendlyErrorMessage(null, "Custom error")).toBe("Custom error");
  });

  it("returns the error message for plain errors", () => {
    expect(getFriendlyErrorMessage(new Error("Workflow step failed"))).toBe("Workflow step failed");
  });

  it("returns fallback for errors containing 'firebase'", () => {
    const fallback = "Something needs attention. Please try again.";
    expect(getFriendlyErrorMessage(new Error("Firebase: auth/id-token-expired"))).toBe(fallback);
  });

  it("returns fallback for errors containing 'token'", () => {
    const fallback = "Something needs attention. Please try again.";
    expect(getFriendlyErrorMessage(new Error("Invalid token signature"))).toBe(fallback);
  });

  it("returns fallback for errors containing 'request failed'", () => {
    const fallback = "Something needs attention. Please try again.";
    expect(getFriendlyErrorMessage(new Error("API request failed with 500"))).toBe(fallback);
  });

  it("returns fallback for non-Error objects", () => {
    expect(getFriendlyErrorMessage({ status: 500 })).toBe("Something needs attention. Please try again.");
    expect(getFriendlyErrorMessage("raw string error")).toBe("Something needs attention. Please try again.");
  });
});
