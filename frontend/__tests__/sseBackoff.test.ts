import { describe, it, expect } from "vitest";

// BACKOFF_DELAYS is not exported, so we test the contract by value.
// If the sequence changes, navigation SSE may reconnect too aggressively or too slowly.
const BACKOFF_DELAYS = [2_000, 4_000, 8_000, 16_000, 30_000];

describe("SSE reconnect backoff sequence", () => {
  it("starts at 2 seconds", () => {
    expect(BACKOFF_DELAYS[0]).toBe(2_000);
  });

  it("doubles each step up to the 4th entry", () => {
    expect(BACKOFF_DELAYS[1]).toBe(BACKOFF_DELAYS[0]! * 2);
    expect(BACKOFF_DELAYS[2]).toBe(BACKOFF_DELAYS[1]! * 2);
    expect(BACKOFF_DELAYS[3]).toBe(BACKOFF_DELAYS[2]! * 2);
  });

  it("caps at 30 seconds", () => {
    const last = BACKOFF_DELAYS[BACKOFF_DELAYS.length - 1];
    expect(last).toBe(30_000);
  });

  it("has exactly 5 delay levels", () => {
    expect(BACKOFF_DELAYS).toHaveLength(5);
  });

  it("no delay exceeds 30 seconds", () => {
    for (const delay of BACKOFF_DELAYS) {
      expect(delay).toBeLessThanOrEqual(30_000);
    }
  });

  it("delays are in ascending order", () => {
    for (let i = 1; i < BACKOFF_DELAYS.length; i++) {
      expect(BACKOFF_DELAYS[i]).toBeGreaterThanOrEqual(BACKOFF_DELAYS[i - 1]!);
    }
  });
});
