import { describe, it, expect, vi, beforeEach } from "vitest";

const searchMock = vi.fn();
vi.mock("../ai/retrieval/retrievalService.js", () => ({
  RetrievalService: class {
    constructor() {}
    similaritySearch = searchMock;
  },
}));

import { buildAgentMemoryBlock } from "../ai/retrieval/agentMemoryContext.js";

describe("buildAgentMemoryBlock", () => {
  beforeEach(() => searchMock.mockReset());

  it("returns an empty string when no memory is found", async () => {
    searchMock.mockResolvedValue([]);
    expect(await buildAgentMemoryBlock({} as never, "w1", "query")).toBe("");
  });

  it("formats retrieved memory chunks into a WORKSPACE MEMORY block", async () => {
    searchMock.mockResolvedValue([
      { sourceType: "memory", sourceId: "m1", workspaceId: "w1", chunkText: "User prefers concise replies", score: 0.92 },
      { sourceType: "artifact", sourceId: "a1", workspaceId: "w1", chunkText: "Company is Acme, B2B SaaS", score: 0.81 },
    ]);
    const block = await buildAgentMemoryBlock({} as never, "w1", "what tone should I use?");
    expect(block).toContain("WORKSPACE MEMORY");
    expect(block).toContain("concise replies");
    expect(block).toContain("Acme");
    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "w1", query: "what tone should I use?" }));
  });

});
