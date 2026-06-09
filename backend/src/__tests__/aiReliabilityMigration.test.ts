import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  AiBudgetExceededError,
  AiExecutionBudget,
  AiExecutionRuntime,
} from "../ai/execution/aiExecutionBudget.js";
import { CommandRouterV2 } from "../ai/routing/commandRouterV2.js";
import { routeDecisionSchema } from "../ai/contracts/commandContracts.js";
import { expertCapabilities } from "../experts/capabilityRegistry.js";
import { expertRegistry } from "../experts/expertRegistry.js";
import {
  resolveGmailApprovalInput,
} from "../integrations/actions/gmailActionService.js";
import {
  HubSpotActionService,
  normalizeHubSpotModule,
} from "../integrations/actions/hubSpotActionService.js";
import { IntegrationWorkspaceService } from "../integrations/integrationWorkspaceService.js";
import { parseOpenAIWebSearchContent } from "../web/providers/openAIWebSearchProvider.js";
import { buildWorkflowDraftPlan } from "../workflows/workflowDraftService.js";

describe("AI reliability migration contracts", () => {
  it("normalizes singular HubSpot object names at the action boundary", () => {
    expect(normalizeHubSpotModule("contact")).toBe("contacts");
    expect(normalizeHubSpotModule("company")).toBe("companies");
    expect(normalizeHubSpotModule("deal")).toBe("deals");
  });

  it("routes an explicit HubSpot field update with normalized action input", async () => {
    const decision = await new CommandRouterV2({} as never).route({
      userQuery: "Update the title of John Doe to ex-CEO in HubSpot",
      explicitMode: "auto",
      originSurface: "command_center",
      selectedItem: null,
      selectedAgentId: "sales",
      availableCapabilities: ["hubspot.crm.read", "hubspot.crm.write"],
      sessionState: null,
      workspaceId: "ws_test",
      userId: "user_test",
    });

    expect(decision.intent).toBe("integration_write");
    expect(decision.objectType).toBe("contacts");
    expect(decision.actionInput).toMatchObject({
      targetQuery: "John Doe",
      updates: { jobtitle: "ex-CEO" },
    });
  });

  it("routes the reported recent-funding request deterministically to quick search", async () => {
    const decision = await new CommandRouterV2({} as never).route({
      userQuery:
        "find startups which recently raised funds in productivity SaaS and voice agents from Y Combinator and a16z",
      explicitMode: "auto",
      originSurface: "command_center",
      selectedItem: null,
      selectedAgentId: "research",
      availableCapabilities: ["web.researchTask"],
      sessionState: null,
      workspaceId: "ws_test",
      userId: "user_test",
    });

    expect(decision.intent).toBe("web_search");
    expect(decision.toolStrategy).toBe("web_search");
    expect(decision.routeSource).toBe("hard_rule");
  });

  it("keeps auto competitor report requests on quick search unless /research is explicit", async () => {
    const decision = await new CommandRouterV2({} as never).route({
      userQuery:
        "I want a brief report on competitors of Recapi AI. First assess Recapi and then find its competitors.",
      explicitMode: "auto",
      originSurface: "command_center",
      selectedItem: null,
      selectedAgentId: "research",
      availableCapabilities: ["web.researchTask"],
      sessionState: null,
      workspaceId: "ws_test",
      userId: "user_test",
    });

    expect(decision.intent).toBe("web_search");
    expect(decision.toolStrategy).toBe("web_search");
    expect(decision.reason).toBe("fresh_or_competitive_quick_search_request");
  });

  it("keeps explicit research mode as deliberate deep research", async () => {
    const decision = await new CommandRouterV2({} as never).route({
      userQuery:
        "I want a brief report on competitors of Recapi AI. First assess Recapi and then find its competitors.",
      explicitMode: "research",
      originSurface: "command_center",
      selectedItem: null,
      selectedAgentId: "research",
      availableCapabilities: ["web.researchTask"],
      sessionState: null,
      workspaceId: "ws_test",
      userId: "user_test",
    });

    expect(decision.intent).toBe("deep_research");
    expect(decision.toolStrategy).toBe("deep_research");
    expect(decision.reason).toBe("explicit_research_mode");
  });

  it("routes recurring workflow requests with email-me language to workflow drafts before Gmail", async () => {
    const decision = await new CommandRouterV2({} as never).route({
      userQuery:
        "I want to setup a workflow where every Monday morning at 9am I get notification in my email report of funding deadlines for Recapi AI and competitor news",
      explicitMode: "auto",
      originSurface: "command_center",
      selectedItem: null,
      selectedAgentId: null,
      availableCapabilities: ["gmail.mail.read", "gmail.mail.write", "web.researchTask"],
      sessionState: null,
      workspaceId: "ws_test",
      userId: "user_test",
    });

    expect(decision.intent).toBe("workflow_create");
    expect(decision.toolStrategy).toBe("workflow");
    expect(decision.expectedResultKind).toBe("workflow_draft");
    expect(decision.provider).toBeUndefined();
  });

  it("builds the Recapi workflow draft with system email notification, not Gmail outbound", () => {
    const plan = buildWorkflowDraftPlan({
      userQuery:
        "I want to setup a workflow where every Monday morning at 9am I get notification in my email report of 3 things for Recapi AI",
      timezone: "Asia/Calcutta",
      sessionState: null,
      sourceRefs: [],
      gmailConnected: true,
    });

    expect(plan.workflowDraft?.triggerType).toBe("schedule");
    expect(plan.workflowDraft?.cron).toBe("0 9 * * 1");
    expect(plan.workflowDraft?.timezone).toBe("Asia/Calcutta");
    expect(plan.workflowDraft?.deliveryIntent).toBe("system_email");
    expect(plan.workflowDraft?.steps.map((step) => step.id)).toEqual([
      "funding-deadline-research",
      "domain-signal-research",
      "competitor-intelligence",
      "synthesis",
      "save-report",
      "notify-owner",
    ]);
    expect(plan.workflowDraft?.steps.at(-1)?.config).toMatchObject({
      channel: "system_email",
      recipient: "workflow_owner",
      includeInAppCopy: true,
    });
  });

  it("builds Gmail outbound workflow steps only for external recipients", () => {
    const plan = buildWorkflowDraftPlan({
      userQuery: "Create a workflow every Monday at 9am and send the report to jane@acme.com through Gmail",
      timezone: "UTC",
      sessionState: null,
      sourceRefs: [],
      gmailConnected: true,
    });

    const gmailStep = plan.workflowDraft?.steps.find((step) => step.type === "integration.action");
    expect(plan.workflowDraft?.deliveryIntent).toBe("gmail_outbound");
    expect(gmailStep?.config).toMatchObject({
      provider: "gmail",
      operation: "prepareSendApproval",
      requiresApproval: true,
    });
  });

  it("continues an explicit follow-up from the prior research result without clarification", async () => {
    const decision = await new CommandRouterV2({} as never).route({
      userQuery:
        "now from the provided list can you share details of those which are highest valued",
      explicitMode: "auto",
      originSurface: "command_center",
      selectedItem: null,
      selectedAgentId: "research",
      availableCapabilities: ["web.researchTask"],
      workspaceId: "ws_test",
      userId: "user_test",
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
    });

    expect(decision.intent).toBe("web_search");
    expect(decision.toolStrategy).toBe("web_search");
    expect(decision.routeSource).toBe("session_context");
    expect(decision.reason).toBe("explicit_follow_up_on_prior_research");
  });

  it("routes capability questions about automation as normal answers, not workflow execution", async () => {
    const decision = await new CommandRouterV2({} as never).route({
      userQuery:
        "also, how can you help me if i want to automate such funding updates of startups? share about your capabilities",
      explicitMode: "auto",
      originSurface: "command_center",
      selectedItem: null,
      selectedAgentId: null,
      availableCapabilities: ["web.researchTask", "workflow.generate"],
      workspaceId: "ws_test",
      userId: "user_test",
      sessionState: null,
    });

    expect(decision.intent).toBe("normal_answer");
    expect(decision.toolStrategy).toBe("none");
    expect(decision.reason).toBe("capability_help_request");
  });

  it("reuses pending CRM disambiguation without rerunning search", async () => {
    const decision = await new CommandRouterV2({} as never).route({
      userQuery: "the second one",
      explicitMode: "auto",
      originSurface: "command_center",
      selectedItem: null,
      selectedAgentId: "sales",
      availableCapabilities: ["hubspot.crm.read", "hubspot.crm.write"],
      workspaceId: "ws_test",
      userId: "user_test",
      sessionState: {
        revision: 1,
        turn: 2,
        activeEntities: [],
        selectedRefs: [],
        recentResults: [],
        sessionSummary: "",
        lastIntent: "integration_write",
        pendingDisambiguation: {
          query: "John Doe",
          createdAtTurn: 2,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          candidates: [
            { provider: "hubspot", objectType: "contacts", id: "1", label: "John A" },
            { provider: "hubspot", objectType: "contacts", id: "2", label: "John B" },
          ],
        },
        pendingAction: {
          provider: "hubspot",
          actionType: "update",
          input: { updates: { jobtitle: "CEO" } },
          createdAtTurn: 2,
        },
        updatedAt: new Date().toISOString(),
      },
    });

    expect(decision.resolvedEntities[0]).toMatchObject({ id: "2", label: "John B" });
    expect(decision.actionInput).toEqual({ updates: { jobtitle: "CEO" } });
  });

  it("builds Gmail approval input from final draft content, not planner JSON", () => {
    const resolved = resolveGmailApprovalInput({
      userInput: "send this to alex@example.com",
      sessionContext: "",
      selectedItem: null,
      plan: {
        intent: "draft",
        answer: "Draft ready.",
        highlights: [],
        sections: [{
          title: "Email draft",
          body: "Subject: Quick follow-up\n\nHi Alex,\n\nThanks for your time today.",
        }],
        artifact: null,
        approval: null,
        notification: null,
        workflowDraft: null,
        requestedCapabilities: [],
        requestedTools: [],
        missingContext: [],
      },
    });
    expect(resolved).toMatchObject({
      to: ["alex@example.com"],
      subject: "Quick follow-up",
    });
  });

  it("returns reusable candidates instead of guessing an ambiguous HubSpot target", async () => {
    vi.spyOn(IntegrationWorkspaceService.prototype, "resolveHubSpotRecord").mockResolvedValue({
      status: "multiple_matches",
      module: "contacts",
      query: "John Doe",
      records: [
        { id: "1", title: "John Doe", subtitle: "one@example.com", properties: {}, updatedAt: null },
        { id: "2", title: "John Doe", subtitle: "two@example.com", properties: {}, updatedAt: null },
      ],
    });
    const route = routeDecisionSchema.parse({
      routeId: "route_1",
      intent: "integration_write",
      toolStrategy: "external_action",
      provider: "hubspot",
      objectType: "contacts",
      action: "update",
      actionInput: { targetQuery: "John Doe", updates: { jobtitle: "CEO" } },
      resolvedEntities: [],
      confidence: 0.95,
      missingRequirements: [],
      expectedResultKind: "approval",
      routeSource: "hard_rule",
      reason: "test",
    });
    const result = await new HubSpotActionService({} as never).prepare({
      currentWorkspace: {} as never,
      userId: "user_test",
      userInput: "update John Doe's title to CEO",
      route,
      selectedItem: null,
      sessionState: null,
    });
    expect(result.status).toBe("multiple_matches");
    if (result.status === "multiple_matches") expect(result.candidates).toHaveLength(2);
  });

  it("enforces aggregate LLM call budgets", () => {
    const budget = new AiExecutionBudget();
    budget.reserveCall(100, 100);
    budget.reserveCall(100, 100);
    expect(() => budget.reserveCall(100, 100)).toThrow(AiBudgetExceededError);
  });

  it("keeps routing calls separate from capability execution calls", () => {
    const budget = new AiExecutionBudget();
    budget.reserveCall(100, 100, "routing");
    budget.reserveCall(100, 100, "routing");
    budget.applyIntent("web_search");

    expect(() => budget.reserveCall(100, 100, "routing")).toThrow(
      AiBudgetExceededError,
    );
    expect(() => budget.reserveCall(100, 100, "execution")).not.toThrow();
    expect(budget.remaining().llmCalls).toBe(2);
  });

  it("reschedules the shared deadline when the authoritative route is known", () => {
    vi.useFakeTimers();
    try {
      const runtime = new AiExecutionRuntime();
      vi.advanceTimersByTime(24_000);
      runtime.applyIntent("web_search");

      expect(runtime.signal.aborted).toBe(false);
      expect(runtime.budget.remaining().deadlineMs).toBeGreaterThan(29_000);
      vi.advanceTimersByTime(29_000);
      expect(runtime.signal.aborted).toBe(false);
      vi.advanceTimersByTime(1_000);
      expect(runtime.signal.aborted).toBe(true);
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("parses citations from LangChain response content annotations", () => {
    const parsed = parseOpenAIWebSearchContent([
      {
        type: "text",
        text: "A cited finding.",
        annotations: [
          {
            type: "citation",
            url: "https://example.com/source",
            title: "Example source",
          },
        ],
      },
    ]);

    expect(parsed.text).toBe("A cited finding.");
    expect(parsed.citations).toEqual([
      {
        url: "https://example.com/source",
        title: "Example source",
      },
    ]);
  });

  it("prevents direct OpenAI model SDK calls in production backend paths", () => {
    const backendRoot = resolve(process.cwd(), "src");
    const productionFiles = readdirSync(backendRoot, {
      recursive: true,
      withFileTypes: true,
    })
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".ts") &&
          !entry.parentPath.includes(`${resolve(backendRoot, "scripts")}`) &&
          !entry.parentPath.includes(`${resolve(backendRoot, "__tests__")}`),
      )
      .map((entry) => resolve(entry.parentPath, entry.name));

    for (const filePath of productionFiles) {
      const source = readFileSync(filePath, "utf8");
      expect(source).not.toMatch(/from\s+["']openai["']/);
      expect(source).not.toMatch(/\bnew\s+OpenAI\s*\(/);
    }
  });

  it("derives every active typed expert from the canonical capability registry", () => {
    const activeTypes = expertCapabilities
      .filter((capability) => capability.lifecycleStatus === "active" && capability.expertType)
      .map((capability) => capability.expertType);
    for (const expertType of activeTypes) {
      expect(expertRegistry[expertType!]).toBeTruthy();
    }
  });
});
