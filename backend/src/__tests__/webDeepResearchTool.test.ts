import { describe, it, expect, vi, beforeEach } from "vitest";

const researchMock = vi.fn();
vi.mock("../web/providers/exaResearchProvider.js", () => {
  class ResearchTimeoutError extends Error {
    constructor(id?: string) {
      super(id);
      this.name = "ResearchTimeoutError";
    }
  }
  return {
    ExaResearchProvider: class {
      research = researchMock;
    },
    ResearchTimeoutError,
  };
});

import { getToolDefinition } from "../tools/toolRegistry.js";

const ctx = { db: {}, currentWorkspace: { workspace: { id: "w1" } }, userId: "u1" } as never;

describe("web.deepResearch tool", () => {
  beforeEach(() => researchMock.mockReset());

  it("returns the synthesized report + structured output on success", async () => {
    researchMock.mockResolvedValue({ researchId: "r1", text: "Report body", structured: { score: 9 }, sourceRefs: [] });
    const tool = getToolDefinition("web.deepResearch")!.buildTool(ctx);
    const out = (await tool.invoke({ query: "research AI infra" })) as { status: string; report: string; structured: unknown };
    expect(out.status).toBe("completed");
    expect(out.report).toBe("Report body");
    expect(out.structured).toEqual({ score: 9 });
    expect(researchMock).toHaveBeenCalledWith(expect.objectContaining({ query: "research AI infra", effort: "low" }));
  });

  // Note: timeout-graceful behavior is covered by the provider's ResearchTimeoutError
  // test (exaResearchProvider.test.ts). The tool's catch maps it to status "running".
});
