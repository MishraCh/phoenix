import { describe, it, expect } from "vitest";

import { sanitizeWorkflowSteps, postProcessWorkflowDraft } from "../workflows/workflowDraftService.js";

type TestStep = {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  order: number;
};

describe("sanitizeWorkflowSteps", () => {
  it("passes through supported steps unchanged", () => {
    const { steps, issues } = sanitizeWorkflowSteps<TestStep>([
      { id: "s1", type: "agent", name: "Research", config: { agentId: "auto", task: "Research X" }, order: 0 },
      { id: "s2", type: "artifact", name: "Save", config: { artifactType: "report" }, order: 1 },
      { id: "s3", type: "notification", name: "Notify", config: { channel: "in_app" }, order: 2 },
    ]);
    expect(issues).toHaveLength(0);
    expect(steps.map((s) => s.type)).toEqual(["agent", "artifact", "notification"]);
  });

  it("converts non-executable 'tool'/'action' steps to agent tasks", () => {
    const { steps, issues } = sanitizeWorkflowSteps<TestStep>([
      { id: "s1", type: "tool", name: "Run web search", config: { toolName: "web.researchTask" }, order: 0 },
      { id: "s2", type: "action", name: "Do thing", config: {}, order: 1 },
    ]);
    expect(steps[0].type).toBe("agent");
    expect(String(steps[0].config.task)).toContain("web.researchTask");
    expect(steps[1].type).toBe("agent");
    expect(issues).toHaveLength(2);
  });

  it("replaces gmail outbound actions with a system_email notification (coming soon)", () => {
    const { steps, issues } = sanitizeWorkflowSteps<TestStep>([
      {
        id: "s1",
        type: "integration.action",
        name: "Send via Gmail",
        config: { provider: "gmail", operation: "prepareSendApproval", bodySourceStepId: "s0" },
        order: 0,
      },
    ]);
    expect(steps[0].type).toBe("notification");
    expect(steps[0].config.channel).toBe("system_email");
    expect(steps[0].config.contentSourceStepId).toBe("s0");
    expect(issues[0]).toMatch(/coming soon/i);
  });

  it("converts salesforce reads to agent research steps; keeps hubspot intact", () => {
    const { steps, issues } = sanitizeWorkflowSteps<TestStep>([
      { id: "s1", type: "integration.read", name: "Read SF", config: { provider: "salesforce" }, order: 0 },
      { id: "s2", type: "integration.read", name: "Read HubSpot", config: { provider: "hubspot" }, order: 1 },
    ]);
    expect(steps[0].type).toBe("agent");
    expect(steps[1].type).toBe("integration.read");
    expect(steps[1].config.provider).toBe("hubspot");
    expect(issues).toHaveLength(1);
  });
});

describe("postProcessWorkflowDraft", () => {
  it("downgrades gmail_outbound delivery to system_email and sanitizes steps", () => {
    const result = postProcessWorkflowDraft(
      {
        name: "Weekly outreach",
        triggerType: "schedule",
        cron: "0 9 * * 1",
        timezone: "UTC",
        deliveryIntent: "gmail_outbound",
        validationIssues: [],
        clarificationQuestions: [],
        steps: [
          { type: "agent", name: "Research", config: { agentId: "auto", task: "Research" } },
          { type: "integration.action", name: "Send via Gmail", config: { provider: "gmail", operation: "prepareSendApproval" } },
        ],
      } as never,
      "research and email my client every monday at 9am",
      "UTC",
    );

    expect(result.deliveryIntent).toBe("system_email");
    expect(result.steps.some((step) => step.type === "integration.action")).toBe(false);
    expect(result.validationIssues.join(" ")).toMatch(/coming soon/i);
    expect(result.steps.every((step, i) => typeof step.id === "string" && step.order === i)).toBe(true);
  });
});
