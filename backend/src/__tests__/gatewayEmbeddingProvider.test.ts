import { describe, it, expect, vi, beforeEach } from "vitest";

const embedManyMock = vi.fn();

vi.mock("ai", () => ({
  embedMany: (...args: unknown[]) => embedManyMock(...args),
}));

vi.mock("../config/env.js", () => ({
  env: {
    AI_GATEWAY_API_KEY: "test-key",
    GATEWAY_EMBEDDING_MODEL: "openai/text-embedding-3-small",
    OPENAI_EMBEDDING_DIMENSIONS: undefined,
  },
}));

import { GatewayEmbeddingProvider } from "../ai/providers/gatewayEmbeddingProvider.js";

describe("GatewayEmbeddingProvider", () => {
  beforeEach(() => embedManyMock.mockReset());

  it("embeds via embedMany with 1536 dimensions and returns the vectors", async () => {
    embedManyMock.mockResolvedValue({ embeddings: [[0.1, 0.2], [0.3, 0.4]] });

    const provider = new GatewayEmbeddingProvider();
    expect(provider.providerName).toBe("gateway-openai");
    expect(provider.dimensions).toBe(1536);

    const vectors = await provider.embed(["a", "b"]);
    expect(vectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);

    const callArg = embedManyMock.mock.calls[0][0] as Record<string, any>;
    expect(callArg.model).toBe("openai/text-embedding-3-small");
    expect(callArg.values).toEqual(["a", "b"]);
    expect(callArg.providerOptions.openai.dimensions).toBe(1536);
  });
});
