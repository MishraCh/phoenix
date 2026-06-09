import { describe, it, expect, vi } from "vitest";

vi.mock("../config/env.js", () => ({
  env: {
    LLM_PROVIDER: "auto",
    EMBEDDING_PROVIDER: "auto",
    AI_GATEWAY_API_KEY: "test-key",
    GATEWAY_FAST_MODEL: "openai/gpt-5.4-mini",
    GATEWAY_DEFAULT_MODEL: "anthropic/claude-sonnet-4.5",
    GATEWAY_REASONING_MODEL: "anthropic/claude-sonnet-4.5",
    GATEWAY_RESEARCH_MODEL: "anthropic/claude-sonnet-4.5",
    GATEWAY_EMBEDDING_MODEL: "openai/text-embedding-3-small",
    OPENAI_EMBEDDING_DIMENSIONS: undefined,
  },
}));

import { createLlmProvider, createEmbeddingProvider } from "../ai/providers/providerRegistry.js";

describe("providerRegistry (auto with Gateway key)", () => {
  it("returns the Gateway LLM provider with the role-specific model", () => {
    expect(createLlmProvider("default").modelName).toBe("anthropic/claude-sonnet-4.5");
    expect(createLlmProvider("fast").modelName).toBe("openai/gpt-5.4-mini");
    expect(createLlmProvider("default").providerName).toBe("gateway");
  });

  it("returns the Gateway embedding provider", () => {
    expect(createEmbeddingProvider().providerName).toBe("gateway-openai");
  });
});
