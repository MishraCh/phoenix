import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("../web/providers/exaWebsetsProvider.js", () => ({
  ExaWebsetsProvider: class {
    create = createMock;
  },
}));

const enqueueMock = vi.fn();
vi.mock("../jobs/jobLockService.js", () => ({
  JobLockService: class {
    enqueueJob = enqueueMock;
  },
}));

import { getToolDefinition } from "../tools/toolRegistry.js";

const ctx = { db: {}, currentWorkspace: { id: "w1", workspace: { id: "w1" } }, userId: "u1" } as never;

describe("leads.buildDataset tool", () => {
  beforeEach(() => {
    createMock.mockReset();
    enqueueMock.mockReset();
  });

  it("creates a webset and enqueues the background poll job", async () => {
    createMock.mockResolvedValue({ websetId: "ws_1" });
    enqueueMock.mockResolvedValue({ id: "job_1" });

    const tool = getToolDefinition("leads.buildDataset")!.buildTool(ctx);
    const out = (await tool.invoke({
      query: "seed-stage AI infra companies",
      count: 20,
      entity: "company",
      enrichments: [{ description: "Total funding", format: "text" }],
    })) as { status: string; websetId: string };

    expect(out.status).toBe("started");
    expect(out.websetId).toBe("ws_1");
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ query: "seed-stage AI infra companies", count: 20, entity: "company" }));
    const enqueueArg = enqueueMock.mock.calls[0][0] as { jobType: string; workspaceId: string; input: Record<string, unknown> };
    expect(enqueueArg.jobType).toBe("exa_webset_poll");
    expect(enqueueArg.workspaceId).toBe("w1");
    expect(enqueueArg.input.websetId).toBe("ws_1");
  });
});
