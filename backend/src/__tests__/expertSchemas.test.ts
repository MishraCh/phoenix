import { describe, expect, it } from "vitest";

import { competitorBattlecardSchema } from "../experts/schemas/competitorBattlecard.js";
import { contactBriefSchema } from "../experts/schemas/contactBrief.js";
import { opportunityScorecardSchema } from "../experts/schemas/opportunityScorecard.js";
import { outreachDraftSchema } from "../experts/schemas/outreachDraft.js";
import { preCallBriefSchema } from "../experts/schemas/preCallBrief.js";
import { signalRadarSchema } from "../experts/schemas/signalRadar.js";

describe("expert schemas", () => {
  it("validates contact briefs", () => {
    expect(() =>
      contactBriefSchema.parse({
        summary: "Acme looks expansion-ready.",
        buyerContext: "VP Revenue owns the renewal and is focused on consolidation.",
        painPoints: ["Multiple tools", "Manual follow-up"],
        signals: ["Hiring SDRs", "Recent funding"],
        recommendedAngle: "Lead with efficiency and revenue visibility.",
        risks: ["Procurement timeline unclear"],
        nextActions: ["Prep ROI angle", "Confirm stakeholder map"],
        confidence: 0.81,
      }),
    ).not.toThrow();
  });

  it("validates pre-call briefs", () => {
    expect(() =>
      preCallBriefSchema.parse({
        objective: "Get agreement on next-step evaluation.",
        accountContext: "The company is consolidating ops and wants fewer tools.",
        likelyObjections: ["Cost", "Migration risk"],
        suggestedQuestions: ["What is blocking consolidation today?"],
        openingLines: ["I want to focus on what has changed since your last evaluation."],
        successCriteria: ["Surface buying trigger", "Book technical follow-up"],
        confidence: 0.76,
      }),
    ).not.toThrow();
  });

  it("validates opportunity scorecards", () => {
    expect(() =>
      opportunityScorecardSchema.parse({
        summary: "Strong renewal with timing pressure.",
        opportunityScore: 78,
        whyNow: ["Contract renewal window", "Active consolidation"],
        accountSignals: ["New operator hire", "Budget cycle open"],
        recommendedPlay: "Push executive alignment and procurement path now.",
        risks: ["Security review may slow timing"],
        nextSteps: ["Confirm legal owner", "Book champion call"],
        crmActionHints: ["Update next step", "Add renewal risk note"],
        confidence: 0.83,
      }),
    ).not.toThrow();
  });

  it("validates outreach drafts", () => {
    expect(() =>
      outreachDraftSchema.parse({
        summary: "Warm follow-up draft for the selected thread.",
        audience: "VP Revenue at Acme",
        subject: "Next step on pipeline visibility",
        body: "Hi team,\n\nFollowing up on our last conversation...",
        rationale: ["References the current priority", "Keeps the ask simple"],
        variants: ["Shorter executive version"],
        confidence: 0.74,
      }),
    ).not.toThrow();
  });

  it("validates competitor battlecards", () => {
    expect(() =>
      competitorBattlecardSchema.parse({
        summary: "Rippling is stronger on breadth, weaker on implementation clarity.",
        competitorOverview: "Rippling positions as an all-in-one ops suite.",
        strengths: ["Brand awareness", "Broad suite"],
        weaknesses: ["Complexity", "Mid-market implementation friction"],
        positioningGap: "Lead with operational clarity and faster adoption.",
        attackAngles: ["Time-to-value", "Focused use case win"],
        watchItems: ["Enterprise pricing moves"],
        confidence: 0.72,
      }),
    ).not.toThrow();
  });

  it("validates signal radar payloads", () => {
    expect(() =>
      signalRadarSchema.parse({
        summary: "Three signals suggest faster buying urgency in AI recruiting.",
        urgency: "high",
        signals: [
          {
            title: "Hiring surge",
            whyItMatters: "Implies budget and team growth",
            implication: "Outbound timing is favorable",
          },
        ],
        implications: ["Pipeline quality may improve", "Competitor pressure may rise"],
        suggestedMoves: ["Prioritize outbound this quarter"],
        confidence: 0.78,
      }),
    ).not.toThrow();
  });

  it("rejects malformed signal radar payloads", () => {
    expect(() =>
      signalRadarSchema.parse({
        summary: "Incomplete",
        urgency: "high",
        signals: [],
        implications: [],
        suggestedMoves: [],
        confidence: 1.4,
      }),
    ).toThrow();
  });
});

