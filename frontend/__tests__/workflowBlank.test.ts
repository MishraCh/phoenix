import { describe, it, expect } from "vitest";

// Verify the contract: blank workflow creation sends an empty steps array.
// We test the module directly to ensure defaultWorkflowSteps was removed.

describe("blank workflow creation", () => {
  it("workflows service does not export defaultWorkflowSteps", async () => {
    const mod = await import("../services/workflows.js");
    expect((mod as Record<string, unknown>)["defaultWorkflowSteps"]).toBeUndefined();
  });

  it("createWorkflow body includes steps: [] when no steps provided", async () => {
    // Capture what gets sent to the API by stubbing globalThis.fetch
    let capturedBody: Record<string, unknown> | null = null;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify({ workflowId: "test-id" }), { status: 200 });
    };

    try {
      const { createWorkflow } = await import("../services/workflows.js");
      await createWorkflow({ firebaseIdToken: "tok", name: "My Workflow" });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!["steps"]).toEqual([]);
  });
});
