import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

/**
 * Behavior taxonomy for the autonomous agent path (auto/research modes).
 * Each test documents what the system does for a class of user query by
 * simulating the model's tool-use decisions and asserting the response shape
 * the frontend renders. The model + Exa + Gateway are mocked for determinism;
 * the real wiring is validated separately (unit + live smoke).
 */

const generateMock = vi.fn();
const capturedAgentConfig: { value?: any } = {};
vi.mock("ai", () => ({
  ToolLoopAgent: class {
    constructor(cfg: any) {
      capturedAgentConfig.value = cfg;
    }
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

vi.mock("../ai/retrieval/agentMemoryContext.js", () => ({
  buildAgentMemoryBlock: vi.fn().mockResolvedValue(""),
}));

vi.mock("../policy/policyService.js", () => ({
  PolicyService: class {
    evaluateAction = () => ({ status: "allowed", requiresApproval: false, reason: "" });
  },
}));

import { ToolLoopAgentService } from "../ai/agentic/toolLoopAgentService.js";

const workspace = { workspace: { id: "w1", profile: {} }, role: "owner" } as any;

function toolDef(name: string) {
  return {
    name,
    description: name,
    inputSchema: z.object({}).passthrough(),
    riskLevel: "low",
    requiresApproval: false,
    exposedToPlanner: true,
    buildTool: () => ({ name, invoke: vi.fn() }),
    available: true,
  };
}

function run(input: Record<string, unknown>) {
  return new ToolLoopAgentService({} as any).run({
    userId: "u1",
    currentWorkspace: workspace,
    mode: "auto",
    ...input,
  } as never) as Promise<any>;
}

describe("agent behavior by query type", () => {
  beforeEach(() => {
    generateMock.mockReset();
    listToolsMock.mockReset();
    listToolsMock.mockResolvedValue([
      toolDef("web.researchTask"),
      toolDef("gmail.prepareSendApproval"),
      toolDef("artifact.create"),
    ]);
  });

  it("NORMAL conversational query → answers directly, no tools, no sources, no actions", async () => {
    // e.g. "what can you do?" — the model needs no tools.
    generateMock.mockResolvedValue({ text: "I can research, draft, and act across your tools.", steps: [] });
    const r = await run({ input: "what can you help me with?" });
    expect(r.resultType).toBe("answer");
    expect(r.answer.length).toBeGreaterThan(0);
    expect(r.sourceRefs).toHaveLength(0);
    expect(r.createdApproval).toBeNull();
    expect(r.proposedActions).toHaveLength(0);
  });

  it("SEARCH-required query → calls web research, returns a grounded answer with sources", async () => {
    // e.g. "what's the latest on company X?"
    generateMock.mockResolvedValue({
      text: "Here is what I found about Acme.",
      steps: [
        {
          toolResults: [
            {
              toolName: "web_researchTask",
              output: {
                sourceRefs: [
                  { sourceType: "web", sourceId: "s1", url: "https://acme.com", provider: "exa_search" },
                  { sourceType: "web", sourceId: "s2", url: "https://news.com/acme", provider: "exa_search" },
                ],
              },
            },
          ],
        },
      ],
    });
    const r = await run({ input: "what's the latest news on Acme?" });
    expect(r.sourceRefs.length).toBe(2);
    expect(r.answer).toContain("Acme");
    expect(r.createdApproval).toBeNull();
  });

  it("RESEARCH query → multi-step, returns synthesized answer with deduped sources", async () => {
    generateMock.mockResolvedValue({
      text: "Deep research summary.",
      steps: [
        { toolResults: [{ toolName: "web_researchTask", output: { sourceRefs: [{ sourceType: "web", sourceId: "a", url: "https://x.com", provider: "exa_search" }] } }] },
        { toolResults: [{ toolName: "web_researchTask", output: { sourceRefs: [{ sourceType: "web", sourceId: "a", url: "https://x.com", provider: "exa_search" }] } }] },
      ],
    });
    const r = await run({ input: "research the AI infra market deeply", mode: "research" });
    expect(r.answer.length).toBeGreaterThan(0);
    expect(r.sourceRefs.length).toBe(1); // deduped by url across steps
  });

  it("ACTIONABLE query (send email) → PROPOSES an approval, never executes the write", async () => {
    // e.g. "email Jane about the proposal" — the model calls prepareSendApproval.
    generateMock.mockResolvedValue({
      text: "I drafted an email to Jane for your approval.",
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
    const r = await run({ input: "email Jane about the Q3 proposal" });
    expect(r.createdApproval?.approvalId).toBe("ap_1");
    expect(r.proposedActions).toHaveLength(1);
    expect(r.proposedActions[0].requiresApproval).toBe(true);
    // resultType stays "answer"; the action is a proposal that lands in Approvals.
    expect(r.resultType).toBe("answer");
  });

  it("MULTI-TOOL agentic query (research then draft) → sources AND a proposed approval", async () => {
    generateMock.mockResolvedValue({
      text: "Researched Acme and drafted outreach.",
      steps: [
        { toolResults: [{ toolName: "web_researchTask", output: { sourceRefs: [{ sourceType: "web", sourceId: "s1", url: "https://acme.com", provider: "exa_search" }] } }] },
        { toolResults: [{ toolName: "gmail_prepareSendApproval", output: { approvalId: "ap_2", label: "Outreach to Acme", riskLevel: "medium", requiresApproval: true } }] },
      ],
    });
    const r = await run({ input: "research Acme and draft an outreach email to their CEO" });
    expect(r.sourceRefs.length).toBe(1);
    expect(r.createdApproval?.approvalId).toBe("ap_2");
    expect(r.proposedActions).toHaveLength(1);
  });

  it("FOLLOW-UP query → prior turns are supplied as working memory (continuity)", async () => {
    generateMock.mockResolvedValue({ text: "Its competitors are ...", steps: [] });
    await run({
      input: "and who are its competitors?",
      messages: [
        { role: "user", content: "Tell me about Stripe" },
        { role: "assistant", content: "Stripe is a payments company." },
      ],
    });
    const callArg = generateMock.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    expect(callArg.messages).toHaveLength(3);
    expect(callArg.messages[0].content).toContain("Stripe");
    expect(callArg.messages.at(-1)?.content).toContain("competitors");
  });

  it("ARTIFACT query (save a report) → surfaces the created artifact", async () => {
    generateMock.mockResolvedValue({
      text: "Saved the market brief to your Library.",
      steps: [
        { toolResults: [{ toolName: "artifact_create", output: { artifactId: "art_1", title: "Market brief", artifactType: "report" } }] },
      ],
    });
    const r = await run({ input: "save that as a market brief in my library" });
    expect(r.createdArtifact?.artifactId).toBe("art_1");
  });

  it("entity-reference query → active entities are injected so pronouns resolve", async () => {
    generateMock.mockResolvedValue({ text: "Done.", steps: [] });
    await run({
      input: "email her the summary",
      sessionState: { activeEntities: [{ label: "Jane Doe", objectType: "contact", id: "c1" }] },
    });
    expect(capturedAgentConfig.value.instructions).toContain("Jane Doe");
    expect(capturedAgentConfig.value.instructions).toContain("ACTIVE ENTITIES");
  });
});
