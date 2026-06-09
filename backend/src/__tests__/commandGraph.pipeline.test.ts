import { describe, it, expect } from "vitest";
import { __testables } from "../ai/graphs/commandGraph.js";
import {
  parseSlashMode,
  shouldSkipToolExecution,
  toolNameForMode,
  buildClassifierUserPrompt,
} from "../ai/graphs/commandGraphUtils.js";

// ─── shouldSkipToolExecution ──────────────────────────────────────────────────

describe("shouldSkipToolExecution", () => {
  it("returns true for auto mode (LLM handles everything)", () => {
    expect(shouldSkipToolExecution("auto")).toBe(true);
  });

  it("returns true for workflow mode (planner generates draft without a tool call)", () => {
    expect(shouldSkipToolExecution("workflow")).toBe(true);
  });

  it("returns false for search (needs web.researchTask)", () => {
    expect(shouldSkipToolExecution("search")).toBe(false);
  });

  it("returns false for research (needs web.researchTask with pro processor)", () => {
    expect(shouldSkipToolExecution("research")).toBe(false);
  });

  it("returns false for extract_url (needs web.extractUrl)", () => {
    expect(shouldSkipToolExecution("extract_url")).toBe(false);
  });
});

// ─── toolNameForMode ──────────────────────────────────────────────────────────

describe("toolNameForMode", () => {
  it("returns web.extractUrl for extract_url mode", () => {
    expect(toolNameForMode("extract_url")).toBe("web.extractUrl");
  });

  it("returns web.researchTask for search mode", () => {
    expect(toolNameForMode("search")).toBe("web.researchTask");
  });

  it("returns web.researchTask for research mode", () => {
    expect(toolNameForMode("research")).toBe("web.researchTask");
  });

  it("returns null for auto (no tool needed)", () => {
    expect(toolNameForMode("auto")).toBeNull();
  });

  it("returns null for workflow (no tool needed)", () => {
    expect(toolNameForMode("workflow")).toBeNull();
  });
});

// ─── buildClassifierUserPrompt ────────────────────────────────────────────────

describe("buildClassifierUserPrompt", () => {
  it("includes follow-up warning when isFollowUp is true", () => {
    const prompt = buildClassifierUserPrompt({
      isFollowUp: true,
      agentName: "Gideon Orchestrator",
      input: "what did you mean by that?",
    });
    expect(prompt).toContain("follow-up turn");
    expect(prompt).toContain("You may still use search/research");
  });

  it("omits follow-up warning when isFollowUp is false", () => {
    const prompt = buildClassifierUserPrompt({
      isFollowUp: false,
      agentName: "Gideon Orchestrator",
      input: "research OpenAI competitors",
    });
    expect(prompt).not.toContain("follow-up");
    expect(prompt).not.toContain("do NOT use research");
  });

  it("always includes agent name and user input", () => {
    const prompt = buildClassifierUserPrompt({
      isFollowUp: false,
      agentName: "Sales Agent",
      input: "find me the top 5 CRMs",
    });
    expect(prompt).toContain("Selected agent: Sales Agent");
    expect(prompt).toContain("User command: find me the top 5 CRMs");
  });

  it("follow-up prompt line comes before agent and input lines", () => {
    const prompt = buildClassifierUserPrompt({
      isFollowUp: true,
      agentName: "Research Agent",
      input: "can you elaborate?",
    });
    const lines = prompt.split("\n");
    expect(lines[0]).toContain("follow-up turn");
    expect(lines[1]).toContain("Selected agent:");
    expect(lines[2]).toContain("User command:");
  });

  it("non-follow-up prompt starts with agent line", () => {
    const prompt = buildClassifierUserPrompt({
      isFollowUp: false,
      agentName: "Gideon Orchestrator",
      input: "search for AI grants",
    });
    const lines = prompt.split("\n");
    expect(lines[0]).toContain("Selected agent:");
  });
});


// ─── tool selection after mode resolves ──────────────────────────────────────

describe("tool selection given resolved mode", () => {
  it("auto mode: skip tool, correct log tag", () => {
    expect(shouldSkipToolExecution("auto")).toBe(true);
    expect(toolNameForMode("auto")).toBeNull();
  });

  it("workflow mode: skip tool, correct log tag", () => {
    expect(shouldSkipToolExecution("workflow")).toBe(true);
    expect(toolNameForMode("workflow")).toBeNull();
  });

  it("search mode: use web.researchTask with lite processor", () => {
    expect(shouldSkipToolExecution("search")).toBe(false);
    expect(toolNameForMode("search")).toBe("web.researchTask");
  });

  it("research mode: use web.researchTask with pro processor", () => {
    expect(shouldSkipToolExecution("research")).toBe(false);
    expect(toolNameForMode("research")).toBe("web.researchTask");
  });

  it("extract_url mode: use web.extractUrl", () => {
    expect(shouldSkipToolExecution("extract_url")).toBe(false);
    expect(toolNameForMode("extract_url")).toBe("web.extractUrl");
  });
});

// ─── slash command override ───────────────────────────────────────────────────

describe("slash command override: user forces a specific mode", () => {
  it("/search forces search mode regardless of input content", () => {
    const result = parseSlashMode("/search what did you mean by that");
    expect(result.mode).toBe("search");
    expect(result.normalizedInput).toBe("what did you mean by that");
  });

  it("/research forces research mode on a conversational input", () => {
    const result = parseSlashMode("/research tell me more about it");
    expect(result.mode).toBe("research");
  });

  it("/workflow forces workflow mode", () => {
    const result = parseSlashMode("/workflow automate lead follow-up");
    expect(result.mode).toBe("workflow");
    expect(result.normalizedInput).toBe("automate lead follow-up");
  });

  it("/extract maps to extract_url", () => {
    const result = parseSlashMode("/extract https://news.ycombinator.com");
    expect(result.mode).toBe("extract_url");
    expect(result.normalizedInput).toBe("https://news.ycombinator.com");
  });

  it("no slash prefix → mode is null (auto path)", () => {
    const result = parseSlashMode("can you help me draft an email");
    expect(result.mode).toBeNull();
    expect(result.normalizedInput).toBe("can you help me draft an email");
  });
});

// ─── follow-up scenario: classifier prompt must carry the guard ───────────────

describe("follow-up question guard in classifier prompt", () => {
  const followUpInputs = [
    "what did you mean?",
    "can you elaborate?",
    "tell me more about point 3",
    "ok",
    "sounds good, go ahead",
    "why?",
  ];

  for (const input of followUpInputs) {
    it(`prompt for "${input}" with sessionContext includes follow-up guard`, () => {
      const prompt = buildClassifierUserPrompt({
        isFollowUp: true,
        agentName: "Gideon Orchestrator",
        input,
      });
      expect(prompt).toContain("You may still use search/research");
    });
  }

  it("first-turn prompt (empty sessionContext) has no follow-up guard", () => {
    const prompt = buildClassifierUserPrompt({
      isFollowUp: false,
      agentName: "Gideon Orchestrator",
      input: "research OpenAI competitors in 2025",
    });
    expect(prompt).not.toContain("You may still use search/research");
  });
});

describe("gmail approval extraction from chat drafts", () => {
  it("builds a real gmail approval payload when chat includes recipient and draft content", () => {
    const resolution = __testables.resolveGmailApprovalFromCommand({
      input: "send it to sharad@xoidlabs.com pitching about gideon",
      sessionContext: "",
      contextSummary: "",
      plan: {
        intent: "approval",
        answer: "Draft ready.",
        highlights: [],
        sections: [
          {
            title: "Draft Email Content",
            body: "Subject: Exciting Investment Opportunity with Gideon\n\nDear Sharad,\n\nHere is the pitch for Gideon.",
          },
        ],
        artifact: null,
        approval: {
          title: "Send Gmail email",
          reason: "Approval required before external send.",
          type: "email_send",
          actionType: "gmail_send",
          toolName: "gmail.prepareSendApproval",
          riskLevel: "medium",
        },
        notification: null,
        workflowDraft: null,
        requestedCapabilities: [],
        requestedTools: [],
        missingContext: [],
      },
    });

    expect(resolution.status).toBe("ready");
    if (resolution.status !== "ready") {
      throw new Error("Expected a ready gmail approval resolution");
    }
    expect(resolution.input.to).toEqual(["sharad@xoidlabs.com"]);
    expect(resolution.input.subject).toBe("Exciting Investment Opportunity with Gideon");
    expect(resolution.input.body).toContain("Dear Sharad");
  });

  it("returns a clear missing-fields message when recipient email is absent", () => {
    const resolution = __testables.resolveGmailApprovalFromCommand({
      input: "send this email now",
      sessionContext: "",
      contextSummary: "",
      plan: {
        intent: "approval",
        answer: "Draft ready.",
        highlights: [],
        sections: [
          {
            title: "Draft Email Content",
            body: "Subject: Exciting Investment Opportunity with Gideon\n\nDear Sharad,\n\nHere is the pitch for Gideon.",
          },
        ],
        artifact: null,
        approval: {
          title: "Send Gmail email",
          reason: "Approval required before external send.",
          type: "email_send",
          actionType: "gmail_send",
          toolName: "gmail.prepareSendApproval",
          riskLevel: "medium",
        },
        notification: null,
        workflowDraft: null,
        requestedCapabilities: [],
        requestedTools: [],
        missingContext: [],
      },
    });

    expect(resolution.status).toBe("missing_fields");
    if (resolution.status !== "missing_fields") {
      throw new Error("Expected a missing-fields resolution");
    }
    expect(resolution.message).toContain("recipient email address");
  });
});

describe("artifact persistence intent gating", () => {
  it("persists artifacts only for explicit save intent in chat", () => {
    expect(__testables.shouldPersistArtifact("save this to library as a brief", "explicit_user_intent")).toBe(true);
    expect(__testables.shouldPersistArtifact("turn this into a report", "explicit_user_intent")).toBe(true);
    expect(__testables.shouldPersistArtifact("what are the best HR tools?", "explicit_user_intent")).toBe(false);
  });

  it("disables artifact persistence when the execution path forbids it", () => {
    expect(__testables.shouldPersistArtifact("save this as a report", "disabled")).toBe(false);
  });
});

describe("deterministic research result assembly", () => {
  it("recognizes the reported startup-funding request as fresh discovery", () => {
    expect(
      __testables.isFreshDiscoveryQuery(
        "find startups which recently raised funds in productivity SaaS and voice agents from Y Combinator and a16z",
      ),
    ).toBe(true);
  });

  it("returns validated research content without invoking the generic planner", () => {
    const plan = __testables.buildResearchPlan("search", {
      status: "completed",
      contentText: "Three recently funded productivity startups were found.",
      completeness: 1,
      confidence: 0.82,
      freshness: "fresh",
      failedSources: [],
      partialResult: false,
    });

    expect(plan.intent).toBe("search");
    expect(plan.answer).toContain("recently funded productivity startups");
    expect(plan.missingContext).toEqual([]);
  });

  it("returns a safe unavailable response instead of throwing on an empty result", () => {
    const plan = __testables.buildResearchPlan("search", {
      status: "unavailable",
      contentText: "",
      completeness: 0,
      confidence: 0,
      freshness: "missing",
      failedSources: ["research:deadline"],
      partialResult: true,
    });

    expect(plan.answer).toContain("temporarily unavailable");
    expect(plan.highlights[0]).toContain("partial");
    expect(plan.missingContext).toContain(
      "Live web research is temporarily unavailable.",
    );
  });
});
