import { describe, it, expect, vi, beforeEach } from "vitest";

const getContentsMock = vi.fn();

vi.mock("exa-js", () => ({
  __esModule: true,
  default: class {
    getContents = getContentsMock;
  },
}));

vi.mock("../config/env.js", () => ({ env: { EXA_API_KEY: "test-key" } }));

import { ExaContentsProvider } from "../web/providers/exaContentsProvider.js";

describe("ExaContentsProvider", () => {
  beforeEach(() => getContentsMock.mockReset());

  it("maps Exa contents to extract pages (highlights → excerpts, text → fullContent)", async () => {
    getContentsMock.mockResolvedValue({
      results: [
        {
          url: "https://acme.com",
          title: "Acme",
          text: "Full article text here.",
          highlights: ["Acme raised $20M", "Series A led by Foo"],
          summary: "Acme funding summary",
        },
      ],
    });

    const provider = new ExaContentsProvider();
    const result = await provider.extract({ urls: ["https://acme.com"], includeFullContent: true });

    expect(result.providerUsed).toBe("exa_contents");
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].url).toBe("https://acme.com");
    expect(result.pages[0].title).toBe("Acme");
    expect(result.pages[0].excerpts).toEqual(["Acme raised $20M", "Series A led by Foo"]);
    expect(result.pages[0].fullContent).toBe("Full article text here.");
    expect(getContentsMock).toHaveBeenCalledWith(
      ["https://acme.com"],
      { text: true, highlights: true, summary: true },
    );
  });

  it("falls back to summary then text snippet when no highlights, and omits fullContent unless requested", async () => {
    getContentsMock.mockResolvedValue({
      results: [{ url: "https://b.com", title: "B", text: "Body text", summary: "Sum" }],
    });
    const result = await new ExaContentsProvider().extract({ urls: ["https://b.com"] });
    expect(result.pages[0].excerpts).toEqual(["Sum"]);
    expect(result.pages[0].fullContent).toBeUndefined();
  });

  it("throws when EXA_API_KEY is missing", async () => {
    const env = (await import("../config/env.js")).env as { EXA_API_KEY?: string };
    env.EXA_API_KEY = undefined;
    await expect(new ExaContentsProvider().extract({ urls: ["https://x.com"] })).rejects.toThrow(/EXA_API_KEY/);
    env.EXA_API_KEY = "test-key";
  });
});
