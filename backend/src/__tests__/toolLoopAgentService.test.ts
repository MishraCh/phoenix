import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const generateMock = vi.fn();
vi.mock("ai", () => ({
  ToolLoopAgent: class {
    constructor(public cfg: any) {}
    generate = generateMock;
  },
  tool: (cfg: any) => cfg,
  stepCountIs: (n: number) => ({ stepCountIs: n }),
}));

vi.mock("../ai/execution/aiExecutionBudget.js", () => ({
  getAiExecutionContext: () => undefined,
  estimateTokens: (s: string) => s.length,
}));

const listToolsMock = vi.fn();
vi.mock("../tools/toolRegistryService.js", () => ({
  ToolRegistryService: class {
    listTools = listToolsMock;
  },
}));

vi.mock("../policy/policyService.js", () => ({
  PolicyService: class {
    evaluateAction = () => ({ status: "allowed", requiresApproval: false, reason: "" });
  },
}));

import { ToolLoopAgentService } from "../ai/agentic/toolLoopAgentService.js";

const baseInput = {
  input: "Research Acme and summarize",
  userId: "u1",
  currentWorkspace: { workspace: { id: "w1", profile: {} }, role: "owner" },
  mode: "auto",
  sessionContext: "",
} as any;

function safeToolDef() {
  return {
    name: "web.researchTask",
    description: "Research",
    inputSchema: z.object({ prompt: z.string() }),
    riskLevel: "low",
    requiresApproval: false,
    exposedToPlanner: true,
    buildTool: () => ({ name: "web.researchTask", invoke: vi.fn() }),
    available: true,
  };
}

describe("ToolLoopAgentService", () => {
  beforeEach(() => {
    generateMock.mockReset();
    listToolsMock.mockReset();
    listToolsMock.mockResolvedValue([safeToolDef()]);
  });

  it("runs the loop and maps the result to the command response shape", async () => {
    generateMock.mockResolvedValue({
      text: "Acme is a SaaS company.",
      steps: [
        {
          toolResults: [
            {
              toolName: "web.researchTask",
              output: {
                sourceRefs: [
                  { sourceType: "web", sourceId: "s1", url: "https://acme.com", provider: "exa_search" },
                ],
              },
            },
          ],
        },
      ],
    });

    const result = (await new ToolLoopAgentService({} as any).run(baseInput)) as any;

    expect(result.answer).toContain("Acme");
    expect(result.resultType).toBe("answer");
    expect(result.sourceRefs.length).toBe(1);
    expect(result.sourceRefs[0].url).toBe("https://acme.com");
    expect(typeof result.agentRunId).toBe("string");
  });

  it("returns a graceful answer when the loop throws", async () => {
    generateMock.mockRejectedValue(new Error("model error"));
    const result = (await new ToolLoopAgentService({} as any).run(baseInput)) as any;
    expect(result.resultType).toBe("answer");
    expect(result.answer.length).toBeGreaterThan(0);
  });
});
