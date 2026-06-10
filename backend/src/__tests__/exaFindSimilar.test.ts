import { describe, it, expect, vi, beforeEach } from "vitest";

const findSimilarMock = vi.fn();
vi.mock("exa-js", () => ({
  Exa: class {
    findSimilarAndContents = findSimilarMock;
  },
}));
vi.mock("../config/env.js", () => ({ env: { EXA_API_KEY: "test-key" } }));

import { ExaSearchProvider } from "../web/providers/exaSearchProvider.js";

describe("ExaSearchProvider.findSimilar", () => {
  beforeEach(() => findSimilarMock.mockReset());

  it("returns related sources as web sourceRefs (excluding the source domain)", async () => {
    findSimilarMock.mockResolvedValue({
      results: [
        { url: "https://b.com", title: "B" },
        { url: "https://c.com", title: "C" },
      ],
    });
    const refs = await new ExaSearchProvider().findSimilar("https://a.com");
    expect(refs).toHaveLength(2);
    expect(refs[0].sourceType).toBe("web");
    expect(refs[0].url).toBe("https://b.com");
    expect(refs[0].provider).toBe("exa_find_similar");
    expect(findSimilarMock).toHaveBeenCalledWith(
      "https://a.com",
      expect.objectContaining({ excludeSourceDomain: true }),
    );
  });

  it("filters out results without a url", async () => {
    findSimilarMock.mockResolvedValue({ results: [{ title: "no url" }, { url: "https://d.com" }] });
    const refs = await new ExaSearchProvider().findSimilar("https://a.com");
    expect(refs).toHaveLength(1);
    expect(refs[0].url).toBe("https://d.com");
  });

  it("throws a clear error when EXA_API_KEY is missing", async () => {
    const env = (await import("../config/env.js")).env as { EXA_API_KEY?: string };
    env.EXA_API_KEY = undefined;
    await expect(new ExaSearchProvider().findSimilar("https://a.com")).rejects.toThrow(/EXA_API_KEY/);
    env.EXA_API_KEY = "test-key";
  });
});
