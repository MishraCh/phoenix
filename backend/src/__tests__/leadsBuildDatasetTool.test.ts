import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
import { env } from "../config/env.js";

const ctx = { db: {}, currentWorkspace: { id: "w1", workspace: { id: "w1" } }, userId: "u1" } as never;

describe("leads.buildDataset tool", () => {
  beforeEach(() => {
    createMock.mockReset();
    enqueueMock.mockReset();
    enqueueMock.mockResolvedValue({ id: "job_1" });
  });
  afterEach(() => {
    (env as { EXA_WEBSETS_ENABLED: boolean }).EXA_WEBSETS_ENABLED = false;
  });

  it("fallback path (Websets disabled): enqueues a search_enrich job, no Websets call", async () => {
    (env as { EXA_WEBSETS_ENABLED: boolean }).EXA_WEBSETS_ENABLED = false;
    const tool = getToolDefinition("leads.buildDataset")!.buildTool(ctx);
    const out = (await tool.invoke({ query: "AI infra companies", count: 10, entity: "company" })) as { status: string; websetId?: string };

    expect(out.status).toBe("started");
    expect(out.websetId).toBeUndefined();
    expect(createMock).not.toHaveBeenCalled();
    const enqueued = enqueueMock.mock.calls[0][0] as { jobType: string; input: Record<string, unknown> };
    expect(enqueued.jobType).toBe("exa_webset_poll");
    expect(enqueued.input.mode).toBe("search_enrich");
    expect(enqueued.input.query).toBe("AI infra companies");
  });

  it("Websets enabled: creates a webset and enqueues with the websetId", async () => {
    (env as { EXA_WEBSETS_ENABLED: boolean }).EXA_WEBSETS_ENABLED = true;
    createMock.mockResolvedValue({ websetId: "ws_1" });
    const tool = getToolDefinition("leads.buildDataset")!.buildTool(ctx);
    const out = (await tool.invoke({ query: "AI infra", count: 5, entity: "company" })) as { websetId?: string };

    expect(out.websetId).toBe("ws_1");
    expect(createMock).toHaveBeenCalled();
    expect((enqueueMock.mock.calls[0][0] as { input: Record<string, unknown> }).input.websetId).toBe("ws_1");
  });

  it("Websets enabled but create fails: falls back to a search_enrich job", async () => {
    (env as { EXA_WEBSETS_ENABLED: boolean }).EXA_WEBSETS_ENABLED = true;
    createMock.mockImplementation(async () => {
      throw new Error("Unauthorized — upgrade to Pro");
    });
    const tool = getToolDefinition("leads.buildDataset")!.buildTool(ctx);
    const out = (await tool.invoke({ query: "AI infra" })) as { status: string; websetId?: string };

    expect(out.status).toBe("started");
    expect(out.websetId).toBeUndefined();
    expect((enqueueMock.mock.calls[0][0] as { input: Record<string, unknown> }).input.mode).toBe("search_enrich");
  });
});
