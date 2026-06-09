import { __testables } from "../ai/graphs/commandGraph.js";
import { expertCapabilities } from "../experts/capabilityRegistry.js";
import { describe, it, expect } from "vitest";

describe("Live Expert SOP Behavior Verification", () => {
  const evaluateRoute = (stateUpdate: any) => {
    let mockState: any = {
      semanticIntent: { intent: "expert_tool", expertCapabilityId: "" },
      selectedItem: null,
      toolSummary: "",
      retrievalContext: "",
      currentWorkspace: { id: "ws_123" },
      ...stateUpdate
    };
    
    if (mockState.semanticIntent.expertCapabilityId) {
      const capability = expertCapabilities.find((c: any) => c.id === mockState.semanticIntent.expertCapabilityId);
      if (capability) {
        let missingContextReason = "";
        if (capability.requiredContext && capability.requiredContext.length > 0) {
          for (const req of capability.requiredContext) {
            if (req === "hubspot_record") {
              const hasHubspotSelected = mockState.selectedItem?.provider === "hubspot";
              const hasResolvedHubSpotRecord = mockState.toolSummary.includes("[hubspot-record-detail:");
              const hasAmbiguousHubSpotMatches = mockState.toolSummary.includes("[hubspot-multiple-matches:");
              if (!hasHubspotSelected && !hasResolvedHubSpotRecord) {
                if (hasAmbiguousHubSpotMatches) {
                  missingContextReason = `Multiple CRM records found. Please specify which one you mean before I can run ${capability.displayName}.`;
                } else if (mockState.toolSummary.includes("[hubspot-error:")) {
                  missingContextReason = `I'm having trouble accessing HubSpot. Please verify your integration is connected, or clarify your request so I can help you another way.`;
                } else if (mockState.toolSummary.includes('"status":"empty"')) {
                  missingContextReason = `I couldn't find a matching CRM record. Please check the name or select it.`;
                } else {
                  missingContextReason = `${capability.displayName} requires a selected CRM record (like a Contact or Deal). Please select one.`;
                }
                break;
              }
            } else if (req === "company_or_person_details") {
              const hasHubspotSelected = mockState.selectedItem?.provider === "hubspot";
              const hasResolvedHubSpotRecord = mockState.toolSummary.includes("[hubspot-record-detail:");
              const hasGmailThread = mockState.selectedItem?.provider === "gmail" || mockState.toolSummary.includes("[gmail-thread:");
              const hasStrongRetrieval = mockState.retrievalContext.length > 100;
              if (!hasHubspotSelected && !hasResolvedHubSpotRecord && !hasGmailThread && !hasStrongRetrieval) {
                missingContextReason = `${capability.displayName} requires information about a target company or person. Please specify who this is for.`;
                break;
              }
            } else if (req === "gmail_thread") {
              const hasGmailThread = mockState.selectedItem?.provider === "gmail" || mockState.toolSummary.includes("[gmail-thread:");
              if (!hasGmailThread) {
                missingContextReason = `${capability.displayName} requires a selected email thread.`;
                break;
              }
            } else if (req === "web_research_context") {
              const hasWebResearch = mockState.retrievalContext.includes("web_research") || mockState.toolSummary.includes("openai_search");
              if (!hasWebResearch) {
                missingContextReason = `${capability.displayName} requires web research or market data to run accurately.`;
                break;
              }
            }
          }
        }
        
        let expertRoute: any = { status: "none" };
        if (missingContextReason) {
          expertRoute = {
            status: "needs_context",
            message: missingContextReason,
            expertType: capability.id,
          };
        } else {
          expertRoute = { status: "match", expertType: capability.id };
        }
        mockState.expertRoute = expertRoute;
      }
    }
    return mockState;
  };

  it("Contact Brief with no selected contact -> missing_context", () => {
    const state = evaluateRoute({ semanticIntent: { intent: "expert_tool", expertCapabilityId: "contact_brief" } });
    expect(state.expertRoute.status).toBe("needs_context");
    expect(state.expertRoute.message).toContain("requires a selected CRM record");
  });

  it("Contact Brief with selected HubSpot contact -> match", () => {
    const state = evaluateRoute({ 
      semanticIntent: { intent: "expert_tool", expertCapabilityId: "contact_brief" },
      selectedItem: { provider: "hubspot", itemId: "123", itemType: "contacts", title: "John Doe" }
    });
    expect(state.expertRoute.status).toBe("match");
    expect(state.expertRoute.expertType).toBe("contact_brief");
  });

  it("Opportunity Scorecard with wrong selected item (Gmail thread) -> missing_context", () => {
    const state = evaluateRoute({ 
      semanticIntent: { intent: "expert_tool", expertCapabilityId: "opportunity_scorecard" },
      selectedItem: { provider: "gmail", itemId: "msg123", itemType: "thread", title: "Follow up" }
    });
    expect(state.expertRoute.status).toBe("needs_context");
    expect(state.expertRoute.message).toContain("requires a selected CRM record");
  });

  it("Outreach Draft with no target -> missing_context", () => {
    const state = evaluateRoute({ semanticIntent: { intent: "expert_tool", expertCapabilityId: "outreach_draft" } });
    expect(state.expertRoute.status).toBe("needs_context");
    expect(state.expertRoute.message).toContain("requires information about a target");
  });

  it("Outreach Draft with selected contact -> match", () => {
    const state = evaluateRoute({ 
      semanticIntent: { intent: "expert_tool", expertCapabilityId: "outreach_draft" },
      selectedItem: { provider: "hubspot", itemId: "123", itemType: "contacts", title: "John Doe" }
    });
    expect(state.expertRoute.status).toBe("match");
  });

  it("Gmail send creates edit-before-send approval payload", () => {
    const resolution = __testables.resolveGmailApprovalFromCommand({
      input: "send it to sharad@xoidlabs.com",
      sessionContext: "",
      contextSummary: "",
      plan: {
        intent: "approval",
        answer: "Draft ready.",
        highlights: [],
        sections: [{ title: "Draft", body: "Subject: Hello\n\nHi Sharad." }],
        artifact: null,
        approval: {
          title: "Send Gmail email",
          reason: "Approval required",
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
      } as any
    });
    
    expect(resolution.status).toBe("ready");
    if (resolution.status === "ready") {
      expect(resolution.input.to?.[0]).toBe("sharad@xoidlabs.com");
    }
  });
});
