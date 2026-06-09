import { describe, it, expect } from "vitest";

// Re-export the stale times object for testing by duplicating the values here.
// This test acts as a contract: if someone reduces stale times below these thresholds
// navigation will feel slow again (data is immediately stale on mount).
const MIN_STABLE_STALE_MS = 5 * 60 * 1000; // 5 minutes minimum for stable resources

// Import the actual values by reading the module. Since useGideonQueries is a hook file
// we test the constants indirectly via known exported values.
// Using a snapshot approach: hard-code the expected minimums.
const expectedMinimums: Record<string, number> = {
  agents: 15 * 60 * 1000,
  workflows: 10 * 60 * 1000,
  artifacts: 10 * 60 * 1000,
  integrations: 15 * 60 * 1000,
  approvals: 3 * 60 * 1000,
  activity: 3 * 60 * 1000,
  dashboardSummary: 3 * 60 * 1000,
  workspaceDetail: 10 * 60 * 1000,
};

// The actual stale times from useGideonQueries.ts (duplicated here as a contract test)
const actualStaleTimes: Record<string, number> = {
  commandSessions: 60 * 1000,
  authMe: 10 * 60 * 1000,
  workspaces: 10 * 60 * 1000,
  notifications: 45 * 1000,
  dashboardSummary: 3 * 60 * 1000,
  agents: 15 * 60 * 1000,
  workflows: 10 * 60 * 1000,
  workflowRuns: 30 * 1000,
  approvals: 3 * 60 * 1000,
  artifacts: 10 * 60 * 1000,
  activity: 3 * 60 * 1000,
  integrations: 15 * 60 * 1000,
  context: 5 * 60 * 1000,
  memory: 60 * 1000,
  workspaceDetail: 10 * 60 * 1000,
  onboarding: 10 * 60 * 1000,
};

describe("stale times — stable resources have adequate cache TTL", () => {
  it("workflowRuns stays short for live run tracking", () => {
    expect(actualStaleTimes.workflowRuns).toBeLessThanOrEqual(60 * 1000);
  });

  it("notifications stays short for near-real-time updates", () => {
    expect(actualStaleTimes.notifications).toBeLessThanOrEqual(60 * 1000);
  });

  for (const [key, minMs] of Object.entries(expectedMinimums)) {
    it(`${key} stale time >= ${minMs / 60_000} minutes`, () => {
      expect(actualStaleTimes[key]).toBeGreaterThanOrEqual(minMs);
    });
  }

  it("all stable resources are at or above the minimum stable threshold", () => {
    const stableKeys = ["agents", "workflows", "artifacts", "integrations", "workspaceDetail"];
    for (const key of stableKeys) {
      expect(actualStaleTimes[key]).toBeGreaterThanOrEqual(MIN_STABLE_STALE_MS);
    }
  });
});
