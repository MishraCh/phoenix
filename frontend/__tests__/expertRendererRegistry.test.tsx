import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { CommandExpertResult } from "../services/command";
import { ExpertRendererRegistry } from "../components/app-shell/command-center/renderers/expertRendererRegistry";

const fixtures: CommandExpertResult[] = [
  {
    kind: "expert",
    expertType: "contact_brief",
    expertGroup: "revenue_intelligence",
    rendererKey: "contact-brief-card",
    payload: {
      summary: "Acme looks ready for a focused follow-up.",
      buyerContext: "VP RevOps owns this evaluation.",
      painPoints: ["Fragmented tooling"],
      signals: ["Hiring SDRs"],
      recommendedAngle: "Lead with consolidation and visibility.",
      risks: ["Procurement timing unclear"],
      nextActions: ["Map stakeholders"],
      confidence: 0.8,
    },
  },
  {
    kind: "expert",
    expertType: "pre_call_brief",
    expertGroup: "revenue_intelligence",
    rendererKey: "pre-call-brief-card",
    payload: {
      objective: "Secure next-step commitment.",
      accountContext: "The company is consolidating vendors.",
      likelyObjections: ["Migration timing"],
      suggestedQuestions: ["What is blocking rollout today?"],
      openingLines: ["I want to focus on your current priority shift."],
      successCriteria: ["Confirm urgency"],
      confidence: 0.76,
    },
  },
  {
    kind: "expert",
    expertType: "opportunity_scorecard",
    expertGroup: "opportunity_analysis",
    rendererKey: "opportunity-scorecard",
    payload: {
      summary: "Good expansion setup with clear momentum.",
      opportunityScore: 77,
      whyNow: ["Renewal window"],
      accountSignals: ["New operator hire"],
      recommendedPlay: "Push next-step alignment now.",
      risks: ["Procurement review"],
      nextSteps: ["Confirm commercial owner"],
      crmActionHints: ["Update next step"],
      confidence: 0.82,
    },
  },
  {
    kind: "expert",
    expertType: "outreach_draft",
    expertGroup: "outreach_messaging",
    rendererKey: "outreach-draft-card",
    payload: {
      summary: "Warm follow-up for the current thread.",
      audience: "VP Revenue",
      subject: "Next step on the evaluation",
      body: "Hi team,\n\nFollowing up on our discussion...",
      rationale: ["Keeps the ask clear"],
      variants: ["Short version"],
      confidence: 0.73,
    },
  },
  {
    kind: "expert",
    expertType: "competitor_battlecard",
    expertGroup: "market_research",
    rendererKey: "competitor-battlecard",
    payload: {
      summary: "Competitor is broader but more complex.",
      competitorOverview: "They sell a broader all-in-one suite.",
      strengths: ["Brand"],
      weaknesses: ["Complexity"],
      positioningGap: "Lead with clarity and focus.",
      attackAngles: ["Time-to-value"],
      watchItems: ["Pricing changes"],
      confidence: 0.7,
    },
  },
  {
    kind: "expert",
    expertType: "signal_radar",
    expertGroup: "market_research",
    rendererKey: "signal-radar-card",
    payload: {
      summary: "Signals point to faster near-term demand.",
      urgency: "high",
      signals: [
        {
          title: "Hiring surge",
          whyItMatters: "Budget likely exists",
          implication: "Outbound timing is favorable",
        },
      ],
      implications: ["More urgency"],
      suggestedMoves: ["Prioritize outreach"],
      confidence: 0.79,
    },
  },
];

describe("ExpertRendererRegistry", () => {
  it("renders all first-tranche expert result types", () => {
    const labels = [
      "Contact Brief",
      "Pre-Call Brief",
      "Opportunity Scorecard",
      "Outreach Draft",
      "Competitor Battlecard",
      "Signal Radar",
    ];

    fixtures.forEach((fixture, index) => {
      const { unmount } = render(<ExpertRendererRegistry result={fixture} />);
      expect(screen.getByText(labels[index])).toBeInTheDocument();
      unmount();
    });
  });
});
