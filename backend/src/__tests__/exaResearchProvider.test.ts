import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
const getMock = vi.fn();
vi.mock("exa-js", () => ({
  Exa: class {
    research = { create: createMock, get: getMock };
  },
}));
vi.mock("../config/env.js", () => ({ env: { EXA_API_KEY: "test-key" } }));

import { ExaResearchProvider, ResearchTimeoutError } from "../web/providers/exaResearchProvider.js";

describe("ExaResearchProvider", () => {
  beforeEach(() => {
    createMock.mockReset();
    getMock.mockReset();
  });

  it("research() polls until completed and returns content + structured output", async () => {
    createMock.mockResolvedValue({ researchId: "r1", status: "pending" });
    getMock
      .mockResolvedValueOnce({ status: "running" })
      .mockResolvedValueOnce({ status: "completed", output: { content: "Deep report on X", parsed: { score: 9 } } });

    const provider = new ExaResearchProvider({ pollIntervalMs: 1, maxPolls: 5 });
    const result = await provider.research({ query: "research X", effort: "low" });

    expect(result.text).toBe("Deep report on X");
    expect(result.structured).toEqual({ score: 9 });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: "research X", model: "exa-research-fast" }),
    );
  });

  it("maps effort to the right model (high → exa-research-pro)", async () => {
    createMock.mockResolvedValue({ researchId: "r1" });
    getMock.mockResolvedValue({ status: "completed", output: { content: "ok" } });
    await new ExaResearchProvider({ pollIntervalMs: 1 }).research({ query: "q", effort: "high" });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ model: "exa-research-pro" }));
  });

  it("research() throws ResearchTimeoutError when it never finishes", async () => {
    createMock.mockResolvedValue({ researchId: "r2" });
    getMock.mockResolvedValue({ status: "running" });
    const provider = new ExaResearchProvider({ pollIntervalMs: 1, maxPolls: 3 });
    await expect(provider.research({ query: "q" })).rejects.toBeInstanceOf(ResearchTimeoutError);
  });

  it("research() throws on a failed research run", async () => {
    createMock.mockResolvedValue({ researchId: "r4" });
    getMock.mockResolvedValue({ status: "failed", error: "boom" });
    const provider = new ExaResearchProvider({ pollIntervalMs: 1, maxPolls: 3 });
    await expect(provider.research({ query: "q" })).rejects.toThrow();
  });

  it("start() returns the researchId; poll() maps a completed run", async () => {
    createMock.mockResolvedValue({ researchId: "r3" });
    const provider = new ExaResearchProvider();
    expect(await provider.start({ query: "q" })).toEqual({ researchId: "r3" });

    getMock.mockResolvedValue({ status: "completed", output: { content: "done" } });
    const polled = await provider.poll("r3");
    expect(polled.done).toBe(true);
    expect(polled.result?.text).toBe("done");
  });

  it("throws when EXA_API_KEY is missing", async () => {
    const env = (await import("../config/env.js")).env as { EXA_API_KEY?: string };
    env.EXA_API_KEY = undefined;
    await expect(new ExaResearchProvider().start({ query: "q" })).rejects.toThrow(/EXA_API_KEY/);
    env.EXA_API_KEY = "test-key";
  });
});
