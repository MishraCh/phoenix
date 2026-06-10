import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
const getMock = vi.fn();
const listMock = vi.fn();
vi.mock("exa-js", () => ({
  Exa: class {
    websets = { create: createMock, get: getMock, items: { list: listMock } };
  },
}));
vi.mock("../config/env.js", () => ({ env: { EXA_API_KEY: "test-key" } }));

import { ExaWebsetsProvider } from "../web/providers/exaWebsetsProvider.js";

describe("ExaWebsetsProvider", () => {
  beforeEach(() => {
    createMock.mockReset();
    getMock.mockReset();
    listMock.mockReset();
  });

  it("create() builds a webset search with enrichments and returns the websetId", async () => {
    createMock.mockResolvedValue({ id: "ws_1", status: "running" });
    const res = await new ExaWebsetsProvider().create({
      query: "seed-stage AI infra companies",
      count: 20,
      entity: "company",
      enrichments: [{ description: "Total funding raised", format: "text" }],
    });
    expect(res).toEqual({ websetId: "ws_1" });
    const arg = createMock.mock.calls[0][0] as { search: { query: string; count: number; entity?: { type: string } }; enrichments: unknown[] };
    expect(arg.search.query).toBe("seed-stage AI infra companies");
    expect(arg.search.count).toBe(20);
    expect(arg.search.entity).toEqual({ type: "company" });
    expect(arg.enrichments).toHaveLength(1);
  });

  it("poll() reports idle only when status is idle", async () => {
    getMock.mockResolvedValueOnce({ status: "running" });
    expect(await new ExaWebsetsProvider().poll("ws_1")).toEqual({ status: "running", idle: false });
    getMock.mockResolvedValueOnce({ status: "idle" });
    expect(await new ExaWebsetsProvider().poll("ws_1")).toEqual({ status: "idle", idle: true });
  });

  it("items() maps webset items to dataset rows (properties + enrichments + sourceRefs)", async () => {
    listMock.mockResolvedValue({
      data: [
        {
          id: "item_1",
          properties: { type: "company", company: { name: "Acme AI" }, url: "https://acme.ai", description: "AI infra" },
          enrichments: [
            { enrichmentId: "e1", title: "Total funding", result: ["$12M"] },
            { enrichmentId: "e2", description: "CEO email", result: "ceo@acme.ai" },
          ],
        },
      ],
    });
    const rows = await new ExaWebsetsProvider().items("ws_1");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("item_1");
    expect(rows[0].enrichments["Total funding"]).toBe("$12M");
    expect(rows[0].enrichments["CEO email"]).toBe("ceo@acme.ai");
    expect(rows[0].sourceRefs[0].url).toBe("https://acme.ai");
    expect(JSON.stringify(rows[0].properties)).toContain("Acme AI");
  });

  it("throws when EXA_API_KEY is missing", async () => {
    const env = (await import("../config/env.js")).env as { EXA_API_KEY?: string };
    env.EXA_API_KEY = undefined;
    await expect(new ExaWebsetsProvider().create({ query: "x" })).rejects.toThrow(/EXA_API_KEY/);
    env.EXA_API_KEY = "test-key";
  });
});
