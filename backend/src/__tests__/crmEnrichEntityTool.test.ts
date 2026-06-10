import { describe, it, expect, vi, beforeEach } from "vitest";

const searchMock = vi.fn();
vi.mock("../web/providers/exaSearchProvider.js", () => ({
  ExaSearchProvider: class {
    search = searchMock;
  },
}));

const generateStructuredMock = vi.fn();
vi.mock("../ai/providers/providerRegistry.js", () => ({
  createLlmProvider: () => ({ generateStructured: generateStructuredMock }),
}));

import { getToolDefinition } from "../tools/toolRegistry.js";

const ctx = { db: {}, currentWorkspace: { id: "w1", workspace: { id: "w1" } }, userId: "u1" } as never;

describe("crm.enrichEntity tool", () => {
  beforeEach(() => {
    searchMock.mockReset();
    generateStructuredMock.mockReset();
  });

  it("enriches a company by name and returns HubSpot-mapped properties + sources", async () => {
    searchMock.mockResolvedValue({
      content: "Acme AI is a SaaS company with ~200 employees.",
      sourceRefs: [{ sourceType: "web", sourceId: "s1", url: "https://acme.ai", provider: "exa_search" }],
    });
    generateStructuredMock.mockResolvedValue({
      fields: [
        { name: "industry", value: "SaaS" },
        { name: "employees", value: "200" },
      ],
    });

    const tool = getToolDefinition("crm.enrichEntity")!.buildTool(ctx);
    const out = (await tool.invoke({
      name: "Acme AI",
      module: "companies",
      recordId: "501",
      fields: ["industry", "employees"],
    })) as {
      entity: { name?: string; recordId?: string; module?: string };
      properties: Record<string, unknown>;
      sourceRefs: unknown[];
    };

    expect(out.entity.recordId).toBe("501");
    expect(out.properties).toEqual({ industry: "SaaS", numberofemployees: "200" });
    expect(out.sourceRefs).toHaveLength(1);
    expect(searchMock).toHaveBeenCalled();
  });

  it("requires a name or domain", async () => {
    const tool = getToolDefinition("crm.enrichEntity")!.buildTool(ctx);
    await expect(tool.invoke({ module: "companies" })).rejects.toBeTruthy();
  });
});
