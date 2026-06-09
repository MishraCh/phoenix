import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const generateObjectMock = vi.fn();

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}));

// Ensure the provider sees a Gateway key.
vi.mock("../config/env.js", () => ({
  env: { AI_GATEWAY_API_KEY: "test-key" },
}));

import { GatewayLlmProvider } from "../ai/providers/gatewayLlmProvider.js";

describe("GatewayLlmProvider", () => {
  beforeEach(() => generateObjectMock.mockReset());

  it("calls generateObject with the model, schema, system, and prompt and returns the object", async () => {
    generateObjectMock.mockResolvedValue({
      object: { answer: "hi" },
      usage: { inputTokens: 10, outputTokens: 3 },
    });

    const provider = new GatewayLlmProvider("anthropic/claude-sonnet-4.5", "default");
    const schema = z.object({ answer: z.string() });

    const result = await provider.generateStructured({
      systemPrompt: "sys",
      userPrompt: "user",
      schema,
    });

    expect(result).toEqual({ answer: "hi" });
    expect(provider.providerName).toBe("gateway");
    expect(provider.modelName).toBe("anthropic/claude-sonnet-4.5");

    const callArg = generateObjectMock.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.model).toBe("anthropic/claude-sonnet-4.5");
    expect(callArg.system).toBe("sys");
    expect(callArg.prompt).toBe("user");
    expect(callArg.schema).toBe(schema);
  });

  it("throws when AI_GATEWAY_API_KEY is missing", async () => {
    const env = (await import("../config/env.js")).env as { AI_GATEWAY_API_KEY?: string };
    env.AI_GATEWAY_API_KEY = undefined;
    const provider = new GatewayLlmProvider("anthropic/claude-sonnet-4.5");
    await expect(
      provider.generateStructured({ systemPrompt: "s", userPrompt: "u", schema: z.object({ a: z.string() }) }),
    ).rejects.toThrow(/AI_GATEWAY_API_KEY/);
    env.AI_GATEWAY_API_KEY = "test-key"; // restore
  });
});
