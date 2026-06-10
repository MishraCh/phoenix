import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const generateMock = vi.fn();
const streamMock = vi.fn();
const generateTextMock = vi.fn();
const capturedAgentConfig: { value?: any } = {};
vi.mock("ai", () => ({
  ToolLoopAgent: class {
    constructor(cfg: any) {
      capturedAgentConfig.value = cfg;
    }
    generate = generateMock;
    stream = streamMock;
  },
  tool: (cfg: any) => cfg,
  stepCountIs: (n: number) => ({ stepCountIs: n }),
  generateText: (...args: unknown[]) => generateTextMock(...args),
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

vi.mock("../ai/retrieval/agentMemoryContext.js", () => ({
  buildAgentMemoryBlock: vi.fn().mockResolvedValue(""),
}));

vi.mock("../policy/policyService.js", () => ({
  PolicyService: class {
    evaluateAction = () => ({ status: "allowed", requiresApproval: false, reason: "" });
  },
}));

import { ToolLoopAgentService } from "../ai/agentic/toolLoopAgentService.js";
import { buildToolLoopInstructions } from "../ai/agentic/toolLoopPrompts.js";

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
    streamMock.mockReset();
    generateTextMock.mockReset();
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

  it("passes prior turns + the new input as messages to the agent (continuity)", async () => {
    generateMock.mockResolvedValue({ text: "ok", steps: [] });
    const input = {
      ...baseInput,
      messages: [
        { role: "user", content: "Tell me about Acme Corp" },
        { role: "assistant", content: "Acme is a SaaS company." },
      ],
    };
    await new ToolLoopAgentService({} as any).run(input);
    const callArg = generateMock.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    expect(Array.isArray(callArg.messages)).toBe(true);
    expect(callArg.messages).toHaveLength(3);
    expect(callArg.messages[0].content).toContain("Acme Corp");
    expect(callArg.messages.at(-1)).toEqual({ role: "user", content: "Research Acme and summarize" });
  });

  it("registers tools with model-safe names (no dots — sanitized for the AI SDK)", async () => {
    generateMock.mockResolvedValue({ text: "ok", steps: [] });
    capturedAgentConfig.value = undefined;
    await new ToolLoopAgentService({} as any).run(baseInput); // safeToolDef name is "web.researchTask"
    const toolKeys = Object.keys(capturedAgentConfig.value.tools);
    expect(toolKeys).toContain("web_researchTask");
    expect(toolKeys.every((k) => /^[a-zA-Z0-9_-]+$/.test(k))).toBe(true);
  });

  it("surfaces a created approval from tool results (result parity)", async () => {
    generateMock.mockResolvedValue({
      text: "Drafted an outreach email for your approval.",
      steps: [
        {
          toolResults: [
            {
              toolName: "gmail_prepareSendApproval",
              output: { approvalId: "ap_1", label: "Email to Jane", riskLevel: "medium", requiresApproval: true },
            },
          ],
        },
      ],
    });
    const result = (await new ToolLoopAgentService({} as any).run(baseInput)) as any;
    expect(result.createdApproval?.approvalId).toBe("ap_1");
    expect(result.createdApproval?.actionType).toBe("email_send");
    expect(result.proposedActions).toHaveLength(1);
    expect(result.proposedActions[0].id).toBe("ap_1");
  });

  it("maps a bulk-write approval to the hubspot_bulk_write actionType (frontend routing)", async () => {
    generateMock.mockResolvedValue({
      text: "Prepared 10 records for your approval.",
      steps: [
        {
          toolResults: [
            { toolName: "hubspot_prepareBulkWriteApproval", output: { approvalId: "ap_bulk", rowCount: 10 } },
          ],
        },
      ],
    });
    const result = (await new ToolLoopAgentService({} as any).run(baseInput)) as any;
    expect(result.createdApproval?.approvalId).toBe("ap_bulk");
    expect(result.createdApproval?.actionType).toBe("hubspot_bulk_write");
  });

  it("runStream emits token deltas and returns the same response shape (with sources)", async () => {
    const tokens = ["Acme ", "is ", "a SaaS company."];
    streamMock.mockResolvedValue({
      textStream: (async function* () {
        for (const t of tokens) yield t;
      })(),
      text: Promise.resolve("Acme is a SaaS company."),
      steps: Promise.resolve([
        {
          toolResults: [
            {
              toolName: "web_researchTask",
              output: { sourceRefs: [{ sourceType: "web", sourceId: "s1", url: "https://acme.com", provider: "exa_search" }] },
            },
          ],
        },
      ]),
    });

    const received: string[] = [];
    const result = (await new ToolLoopAgentService({} as any).runStream(baseInput, (d) => received.push(d))) as any;

    expect(received).toEqual(tokens);
    expect(result.answer).toBe("Acme is a SaaS company.");
    expect(result.resultType).toBe("answer");
    expect(result.sourceRefs).toHaveLength(1);
    expect(result.sourceRefs[0].url).toBe("https://acme.com");
  });

  it("recovers an honest answer when the loop ends with no final text (step cap after tool call)", async () => {
    streamMock.mockResolvedValue({
      textStream: (async function* () {})(),
      text: Promise.resolve(""),
      steps: Promise.resolve([
        {
          toolCalls: [{ toolName: "hubspot_searchCompanies", input: { query: "xoidlabs" } }],
          toolResults: [{ toolName: "hubspot_searchCompanies", output: { records: [] } }],
        },
      ]),
    });
    generateTextMock.mockResolvedValue({ text: "I searched HubSpot but found no company named xoidlabs." });

    const received: string[] = [];
    const result = (await new ToolLoopAgentService({} as any).runStream(baseInput, (d) => received.push(d))) as any;

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const recoveryArg = generateTextMock.mock.calls[0][0] as { prompt: string };
    expect(recoveryArg.prompt).toContain("hubspot_searchCompanies");
    expect(result.answer).toContain("no company named xoidlabs");
    expect(received.join("")).toContain("no company named xoidlabs");
  });

  it("falls back to the canned line only when recovery itself fails", async () => {
    streamMock.mockResolvedValue({
      textStream: (async function* () {})(),
      text: Promise.resolve(""),
      steps: Promise.resolve([
        { toolCalls: [{ toolName: "web_researchTask", input: { prompt: "x" } }], toolResults: [] },
      ]),
    });
    generateTextMock.mockRejectedValue(new Error("gateway down"));

    const result = (await new ToolLoopAgentService({} as any).runStream(baseInput, () => {})) as any;
    expect(result.answer).toBe("I couldn't complete that request.");
  });
});

describe("describeSteps / toolNamesFromSteps", () => {
  it("builds a compact transcript from content parts incl. tool errors", async () => {
    const { describeSteps, toolNamesFromSteps } = await import("../ai/agentic/toolLoopAgentService.js");
    const steps = [
      {
        content: [
          { type: "tool-call", toolName: "crm_enrichEntity", input: { name: "xoidlabs" } },
          { type: "tool-error", toolName: "crm_enrichEntity", error: "record not found" },
        ],
      },
    ];
    const transcript = describeSteps(steps as any);
    expect(transcript).toContain("crm_enrichEntity");
    expect(transcript).toContain("ERROR: record not found");
    expect(toolNamesFromSteps(steps as any)).toEqual(["crm_enrichEntity"]);
  });
});

describe("buildToolLoopInstructions", () => {
  it("injects the active-entities register when present", () => {
    const out = buildToolLoopInstructions({
      input: "email her",
      userId: "u1",
      currentWorkspace: { workspace: { id: "w1" } },
      sessionState: { activeEntities: [{ label: "Jane Doe", objectType: "contact", id: "c1" }] },
    } as never);
    expect(out).toContain("ACTIVE ENTITIES");
    expect(out).toContain("Jane Doe");
    expect(out).toContain("c1");
  });

  it("omits the entity block when there are no entities", () => {
    const out = buildToolLoopInstructions({
      input: "hello",
      userId: "u1",
      currentWorkspace: { workspace: { id: "w1" } },
    } as never);
    expect(out).not.toContain("ACTIVE ENTITIES");
  });
});
