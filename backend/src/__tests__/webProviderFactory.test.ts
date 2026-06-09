import { describe, it, expect, vi } from "vitest";

vi.mock("../config/env.js", () => ({
  env: { WEB_SEARCH_PROVIDER: "exa", WEB_EXTRACT_PROVIDER: "exa", EXA_API_KEY: "k", OPENAI_API_KEY: "k" },
}));

import { createSearchProvider, createExtractProvider } from "../web/providers/providerFactory.js";
import { ExaSearchProvider } from "../web/providers/exaSearchProvider.js";
import { ExaContentsProvider } from "../web/providers/exaContentsProvider.js";

describe("web provider factory", () => {
  it("returns Exa providers when env selects exa", () => {
    expect(createSearchProvider()).toBeInstanceOf(ExaSearchProvider);
    expect(createExtractProvider()).toBeInstanceOf(ExaContentsProvider);
  });
});
