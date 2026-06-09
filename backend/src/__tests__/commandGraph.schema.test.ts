import { describe, it, expect } from "vitest";
import { commandPlanSchema, commandModeClassifierSchema } from "../ai/schemas/commandOutput.js";

const basePlan = {
  intent: "other" as const,
  answer: "Here is the answer.",
  highlights: [],
  sections: [],
  artifact: null,
  requestedCapabilities: [],
  requestedTools: [],
  missingContext: [],
};

describe("commandPlanSchema — nullish optional fields", () => {
  it("parses successfully when approval is omitted (undefined)", () => {
    expect(() => commandPlanSchema.parse({ ...basePlan })).not.toThrow();
  });

  it("parses successfully when notification is omitted", () => {
    expect(() => commandPlanSchema.parse({ ...basePlan })).not.toThrow();
  });

  it("parses successfully when workflowDraft is omitted", () => {
    expect(() => commandPlanSchema.parse({ ...basePlan })).not.toThrow();
  });

  it("parses successfully when approval is explicitly null", () => {
    expect(() => commandPlanSchema.parse({ ...basePlan, approval: null })).not.toThrow();
  });

  it("parses successfully when all optional fields are null", () => {
    expect(() =>
      commandPlanSchema.parse({
        ...basePlan,
        approval: null,
        notification: null,
        workflowDraft: null,
      }),
    ).not.toThrow();
  });

  it("parses a full approval object correctly", () => {
    const result = commandPlanSchema.parse({
      ...basePlan,
      approval: {
        title: "Send Email",
        reason: "Requires confirmation",
        type: "email_send",
        actionType: "email",
        toolName: "gmail.send",
        riskLevel: "medium",
      },
    });
    expect(result.approval?.type).toBe("email_send");
  });

  it("coerces an unknown intent value to 'other' (never crashes on LLM hallucination)", () => {
    const result = commandPlanSchema.parse({ ...basePlan, intent: "invalid_intent" });
    expect(result.intent).toBe("other");
  });

  it("accepts 'search' as a valid intent (returned by planner for search-mode responses)", () => {
    const result = commandPlanSchema.parse({ ...basePlan, intent: "search" });
    expect(result.intent).toBe("search");
  });

  it("rejects missing required answer field", () => {
    const { answer: _answer, ...withoutAnswer } = basePlan;
    expect(() => commandPlanSchema.parse(withoutAnswer)).toThrow();
  });
});

describe("commandModeClassifierSchema", () => {
  it("parses valid mode classification", () => {
    const result = commandModeClassifierSchema.parse({ mode: "research", reason: "Needs deep analysis" });
    expect(result.mode).toBe("research");
    expect(result.reason).toBe("Needs deep analysis");
  });

  it("rejects invalid mode value", () => {
    expect(() => commandModeClassifierSchema.parse({ mode: "invalid", reason: "x" })).toThrow();
  });

  it("accepts all valid modes", () => {
    const modes = ["auto", "search", "research", "extract_url", "workflow"] as const;
    for (const mode of modes) {
      expect(() => commandModeClassifierSchema.parse({ mode, reason: "test" })).not.toThrow();
    }
  });
});
