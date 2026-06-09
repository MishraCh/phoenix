import { describe, it, expect, vi, beforeEach } from "vitest";

const answerMock = vi.fn();

vi.mock("exa-js", () => ({
  Exa: class {
    answer = answerMock;
  },
}));

vi.mock("../config/env.js", () => ({ env: { EXA_API_KEY: "test-key" } }));

import { ExaSearchProvider } from "../web/providers/exaSearchProvider.js";

describe("ExaSearchProvider", () => {
  beforeEach(() => answerMock.mockReset());

  it("returns the grounded answer as content and citations as web sourceRefs", async () => {
    answerMock.mockResolvedValue({
      answer: "Acme raised $20M in 2026.",
      citations: [
        { url: "https://techcrunch.com/acme", title: "Acme raises Series A" },
        { url: "https://acme.com/news", title: "Acme news" },
      ],
    });

    const provider = new ExaSearchProvider();
    const result = await provider.search({ query: "How much did Acme raise?" });

    expect(result.content).toBe("Acme raised $20M in 2026.");
    expect(result.sourceRefs).toHaveLength(2);
    expect(result.sourceRefs[0].sourceType).toBe("web");
    expect(result.sourceRefs[0].url).toBe("https://techcrunch.com/acme");
    expect(result.sourceRefs[0].provider).toBe("exa_search");
    expect(answerMock).toHaveBeenCalledWith("How much did Acme raise?", { text: true });
  });

  it("dedupes citations by url", async () => {
    answerMock.mockResolvedValue({
      answer: "x",
      citations: [
        { url: "https://a.com", title: "A" },
        { url: "https://a.com", title: "A dup" },
      ],
    });
    const result = await new ExaSearchProvider().search({ query: "q" });
    expect(result.sourceRefs).toHaveLength(1);
  });

  it("throws when EXA_API_KEY is missing", async () => {
    const env = (await import("../config/env.js")).env as { EXA_API_KEY?: string };
    env.EXA_API_KEY = undefined;
    await expect(new ExaSearchProvider().search({ query: "q" })).rejects.toThrow(/EXA_API_KEY/);
    env.EXA_API_KEY = "test-key";
  });
});
