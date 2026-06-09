import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { CommandGraphService } from "../ai/graphs/commandGraph.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";
import { SemanticIntentClassifier } from "../ai/routing/semanticIntentClassifier.js";
import { ToolRegistryService } from "../tools/toolRegistryService.js";
import { PolicyService } from "../policy/policyService.js";
import { ActivityService } from "../activity/activityService.js";
import { createLlmProvider } from "../ai/providers/providerRegistry.js";
import {
  AiExecutionRuntime,
  runWithAiExecutionContext,
} from "../ai/execution/aiExecutionBudget.js";

vi.mock("../activity/activityService.js");
vi.mock("../ai/routing/semanticIntentClassifier.js");
vi.mock("../ai/providers/providerRegistry.js");
vi.mock("../sse/eventBus.js", () => ({ publishEvent: vi.fn() }));

function asDb(fake: FakeFirestore) {
  return fake as unknown as Firestore;
}

describe("CommandGraph Flow Tests", () => {
  let fakeDb: FakeFirestore;
  let db: Firestore;
  let commandGraphService: CommandGraphService;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeDb = new FakeFirestore();
    db = asDb(fakeDb);
    commandGraphService = new CommandGraphService(db);

    // Mock ActivityService
    vi.spyOn(ActivityService.prototype, "createEvent").mockResolvedValue({ id: "act_1" } as any);
    
    // Mock ToolRegistryService methods to prevent undefined returns
    vi.spyOn(ToolRegistryService.prototype, "getMissingCapabilities").mockResolvedValue([]);
    vi.spyOn(ToolRegistryService.prototype, "listCapabilities").mockResolvedValue([]);
    
    // Mock PolicyService to prevent missing tool errors
    vi.spyOn(PolicyService.prototype, "assertActionAllowed").mockReturnValue({
      toolName: "mockTool",
      actionType: "mockAction",
      status: "allowed",
      riskLevel: "low",
      requiresApproval: false,
      reason: "Mock policy reason",
    });
    
    // Seed test workspace and user
    fakeDb.seed("workspaces/ws_test", {
      name: "Test Workspace",
      ownerId: "user_test",
      plan: "pro",
      planSource: "system",
      monthlyCreditsLimit: 1000,
      monthlyCreditsUsed: 0,
      billingCycleStartAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    fakeDb.seed("users/user_test", {
      id: "user_test",
      email: "test@example.com",
      displayName: "Test User",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  });

  describe("Gideon Expansion: Email Intelligence & Missing Context", () => {
    it("should handle missing context via clarification_needed intent", async () => {
      // Mock the semantic intent classifier to return clarification_needed
      vi.spyOn(SemanticIntentClassifier.prototype, "classify").mockResolvedValue({
        intent: "clarification_needed",
        expertCapabilityId: null,
        integrationParams: null,
        reason: "Which email thread would you like me to draft a reply for?",
      });

      // The graph should use the reason from the classifier or let the LLM generate a response
      // For this test, we just want to ensure it completes and returns a clarification request
      const mockLlm = {
        modelName: "mock-model",
        generateStructured: vi.fn().mockResolvedValue({
          answer: "I need to know which email thread you want to reply to.",
          clarificationQuestion: "Which email thread would you like me to draft a reply for?",
          sections: [],
          missingContext: ["Which email thread would you like me to draft a reply for?"],
          intent: "clarification",
          requestedTools: [],
          requestedCapabilities: []
        }),
        generateText: vi.fn(),
      };
      (createLlmProvider as any).mockReturnValue(mockLlm);

      const currentWorkspaceMock = {
        id: "ws_test",
        workspace: { id: "ws_test", plan: "pro", monthlyCreditsLimit: 1000, monthlyCreditsUsed: 0 },
        member: { role: "owner" },
        role: "owner"
      } as any;

      const result = await commandGraphService.run({
        input: "Draft a reply saying I agree.",
        userId: "user_test",
        currentWorkspace: currentWorkspaceMock,
      });

      expect(result.missingContext).toContain("Which email thread would you like me to draft a reply for?");
      expect(result.resultType).toBe("clarification");
    });
  });

  describe("Workflow Refinement: workflow.generate", () => {
    it("should successfully plan and generate a workflow", async () => {
      // Intent -> workflow_create
      vi.spyOn(SemanticIntentClassifier.prototype, "classify").mockResolvedValue({
        intent: "workflow_create",
        expertCapabilityId: null,
        integrationParams: null,
        reason: "User wants to create a new automation.",
      });

      // Planner LLM
      const mockLlm = {
        modelName: "mock-model",
        generateStructured: vi.fn().mockResolvedValue({
          answer: "I have drafted a workflow for you.",
          sections: [],
          workflowDraft: {
            name: "Monitor and Email",
            triggerType: "schedule",
            steps: [
              { id: "step1", type: "monitor", name: "Monitor Blog", config: { targetType: "url", target: "https://openai.com/blog" }, order: 0 },
              { id: "step2", type: "agent", name: "Summarize", config: { task: "Summarize the changes" }, order: 1 },
              { id: "step3", type: "integration.action", name: "Draft Email", config: { provider: "gmail", operation: "sendEmail" }, order: 2 },
            ]
          },
          requestedTools: ["workflow.generate"],
          requestedCapabilities: [],
          missingContext: [],
          intent: "workflow"
        }),
        generateText: vi.fn(),
      };
      (createLlmProvider as any).mockReturnValue(mockLlm);

      // Mock ToolRegistryService to return a fake workflow tool execution
      vi.spyOn(ToolRegistryService.prototype, "buildToolSet").mockResolvedValue([{
        name: "workflow.generate",
        description: "Generate workflow",
        invoke: async () => ({
          workflowId: "wf_gen_1",
          name: "Monitor and Email",
          triggerType: "schedule",
          stepCount: 3,
        })
      }] as any);

      const currentWorkspaceMock = {
        id: "ws_test",
        workspace: { id: "ws_test", plan: "pro", monthlyCreditsLimit: 1000, monthlyCreditsUsed: 0 },
        member: { role: "owner" },
        role: "owner"
      } as any;

      const result = await commandGraphService.run({
        input: "Create a workflow to monitor OpenAI blog and email me changes.",
        mode: "workflow",
        userId: "user_test",
        currentWorkspace: currentWorkspaceMock,
      });

      expect(result.createdWorkflow).toBeNull();
      expect(result.resultType).toBe("workflow_draft");
      expect(result.result).toMatchObject({
        kind: "workflow_draft",
        draft: {
          name: "Monitor and Email",
          steps: expect.arrayContaining([
            expect.objectContaining({ name: expect.any(String) }),
          ]),
        },
      });
      expect(result.answer).toBe("I have drafted a workflow for you.");
    });
  });

  describe("Research request reliability", () => {
    it("completes the reported recent-funding query without semantic classification or generic planning", async () => {
      const input =
        "find startups which recently raised funds in productivity SaaS and voice agents from Y Combinator and a16z";
      const genericPlanner = vi.fn();
      (createLlmProvider as any).mockReturnValue({
        modelName: "mock-model",
        generateStructured: genericPlanner,
        generateText: vi.fn(),
      });
      const semanticClassifier = vi.spyOn(
        SemanticIntentClassifier.prototype,
        "classify",
      );
      vi.spyOn(
        ToolRegistryService.prototype,
        "buildToolSetFromCapabilities",
      ).mockReturnValue([
        {
          name: "web.researchTask",
          invoke: vi.fn().mockResolvedValue({
            status: "completed",
            provider: "openai_graph",
            contentText:
              "1. Acme Voice raised a seed round led by a reputable venture firm.",
            sourceRefs: [],
            citations: [],
            confidence: 0.8,
            completeness: 1,
            freshness: "fresh",
            failedSources: [],
            partialResult: false,
          }),
        },
      ] as any);
      fakeDb.seed("workspaces/ws_research", {
        name: "Research Workspace",
        ownerId: "user_test",
        plan: "pro",
        monthlyCreditsLimit: 1000,
        monthlyCreditsUsed: 0,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      fakeDb.seed("workspaces/ws_research/settings/aiRollout", {
        flags: {
          ROUTE_V2_SHADOW: true,
          ROUTE_V2_ACTIVE: false,
        },
      });
      const runtime = new AiExecutionRuntime();

      try {
        const result = await runWithAiExecutionContext(
          {
            requestId: "request_research_regression",
            workspaceId: "ws_research",
            userId: "user_test",
            budget: runtime.budget,
            signal: runtime.signal,
            applyBudgetProfile: (intent) => runtime.applyIntent(intent),
            recordUsage: () => undefined,
          },
          () =>
            commandGraphService.run({
              input,
              mode: "auto",
              userId: "user_test",
              currentWorkspace: {
                id: "ws_research",
                workspace: {
                  id: "ws_research",
                  name: "Research Workspace",
                  plan: "pro",
                  monthlyCreditsLimit: 1000,
                  monthlyCreditsUsed: 0,
                },
                member: { role: "owner" },
                role: "owner",
              } as any,
            }),
        );

        expect(result.resultType).toBe("search");
        expect(result.answer).toContain("Acme Voice");
        expect(result.partialResult).toBeNull();
        expect(semanticClassifier).not.toHaveBeenCalled();
        expect(genericPlanner).not.toHaveBeenCalled();
        expect(runtime.budget.remaining().llmCalls).toBe(3);
      } finally {
        runtime.dispose();
      }
    });

    it("uses the exact prior research list for valuation follow-ups instead of asking for clarification", async () => {
      const toolInvoke = vi.fn().mockResolvedValue({
        status: "completed",
        provider: "openai_graph",
        contentText:
          "Town has the highest disclosed valuation among the previously listed startups.",
        sourceRefs: [],
        citations: [],
        confidence: 0.82,
        completeness: 1,
        freshness: "fresh",
        failedSources: [],
        partialResult: false,
      });
      vi.spyOn(
        ToolRegistryService.prototype,
        "buildToolSetFromCapabilities",
      ).mockReturnValue([
        {
          name: "web.researchTask",
          invoke: toolInvoke,
        },
      ] as any);
      const semanticClassifier = vi.spyOn(
        SemanticIntentClassifier.prototype,
        "classify",
      );
      const genericPlanner = vi.fn();
      (createLlmProvider as any).mockReturnValue({
        modelName: "mock-model",
        generateStructured: genericPlanner,
        generateText: vi.fn(),
      });
      const runtime = new AiExecutionRuntime();

      try {
        const result = await runWithAiExecutionContext(
          {
            requestId: "request_research_follow_up",
            workspaceId: "ws_test",
            userId: "user_test",
            budget: runtime.budget,
            signal: runtime.signal,
            applyBudgetProfile: (intent) => runtime.applyIntent(intent),
            recordUsage: () => undefined,
          },
          () =>
            commandGraphService.run({
              input:
                "now from the provided list can you share details of those which are highest valued",
              mode: "auto",
              userId: "user_test",
              sessionContext:
                "Gideon: 1. Town - raised $55 million. 2. AthexeAI - recently funded voice AI startup.",
              sessionState: {
                revision: 1,
                turn: 1,
                activeEntities: [],
                selectedRefs: [],
                recentResults: [
                  {
                    messageId: "message_research_1",
                    resultKind: "research",
                    entityIds: [],
                    sourceRefs: [],
                    compactPayload: {
                      kind: "search",
                      summary:
                        "1. Town - raised $55 million. 2. AthexeAI - recently funded voice AI startup.",
                    },
                  },
                ],
                sessionSummary: "",
                lastIntent: "web_search",
                updatedAt: new Date().toISOString(),
              },
              currentWorkspace: {
                id: "ws_test",
                workspace: {
                  id: "ws_test",
                  name: "Test Workspace",
                  plan: "pro",
                  monthlyCreditsLimit: 1000,
                  monthlyCreditsUsed: 0,
                },
                member: { role: "owner" },
                role: "owner",
              } as any,
            }),
        );

        expect(result.resultType).toBe("search");
        expect(result.answer).toContain("highest disclosed valuation");
        expect(semanticClassifier).not.toHaveBeenCalled();
        expect(genericPlanner).not.toHaveBeenCalled();
        expect(toolInvoke).toHaveBeenCalledTimes(1);
        expect(toolInvoke.mock.calls[0]?.[0]?.prompt).toContain(
          "1. Town - raised $55 million",
        );
        expect(toolInvoke.mock.calls[0]?.[0]?.prompt).toContain(
          "Do not ask which list they mean",
        );
      } finally {
        runtime.dispose();
      }
    });

    it("answers funding automation capability questions without heavy planning or timing out", async () => {
      const plannerGenerate = vi.fn();
      (createLlmProvider as any).mockReturnValue({
        modelName: "mock-model",
        generateStructured: plannerGenerate,
        generateText: vi.fn(),
      });
      const semanticClassifier = vi.spyOn(
        SemanticIntentClassifier.prototype,
        "classify",
      );
      const listCapabilities = vi.spyOn(
        ToolRegistryService.prototype,
        "listCapabilities",
      );
      const buildTools = vi.spyOn(
        ToolRegistryService.prototype,
        "buildToolSetFromCapabilities",
      );

      const result = await commandGraphService.run({
        input:
          "also, how can you help me if i want to automate such funding updates of startups? share about your capabilities",
        mode: "auto",
        userId: "user_test",
        sessionContext:
          "Gideon: 1. Town - raised $55 million. 2. AthexeAI - recently funded voice AI startup.",
        currentWorkspace: {
          id: "ws_test",
          workspace: {
            id: "ws_test",
            name: "Test Workspace",
            plan: "pro",
            monthlyCreditsLimit: 1000,
            monthlyCreditsUsed: 0,
          },
          member: { role: "owner" },
          role: "owner",
        } as any,
      });

      expect(result.resultType).toBe("capability_guide");
      expect(result.answer).toContain("startup-funding intelligence workflow");
      expect(result.result).toMatchObject({
        kind: "capability_guide",
      });
      expect((result.result as any)?.categories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: "Create workflows" }),
        ]),
      );
      expect(semanticClassifier).not.toHaveBeenCalled();
      expect(plannerGenerate).not.toHaveBeenCalled();
      expect(listCapabilities).not.toHaveBeenCalled();
      expect(buildTools).not.toHaveBeenCalled();
    });
  });
});
