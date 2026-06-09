import { describe, it, expect } from "vitest";
import { contactBriefSchema } from "../experts/schemas/contactBrief.js";
import { opportunityScorecardSchema } from "../experts/schemas/opportunityScorecard.js";
import { outreachDraftSchema } from "../experts/schemas/outreachDraft.js";
import { signalRadarSchema } from "../experts/schemas/signalRadar.js";

describe("Expert SOP Robustness & Schema Validation", () => {
  it("Contact Brief defaults to ready status and requires minimal fields", () => {
    const result = contactBriefSchema.parse({});
    expect(result.status).toBe("ready");
    expect(result.risks).toEqual([]);
  });

  it("Opportunity Scorecard supports missing_context and ready states", () => {
    const ready = opportunityScorecardSchema.parse({
      status: "ready",
      summary: "Looks good",
      whyNow: ["Reason 1"],
    });
    expect(ready.status).toBe("ready");

    const missing = opportunityScorecardSchema.parse({
      status: "missing_context",
      clarificationQuestion: "Which deal?",
    });
    expect(missing.status).toBe("missing_context");
    expect(missing.clarificationQuestion).toBe("Which deal?");
  });

  it("Outreach Draft supports missing_context state", () => {
    const missing = outreachDraftSchema.parse({
      status: "missing_context",
      missingFields: ["audience", "subject"],
    });
    expect(missing.status).toBe("missing_context");
    expect(missing.missingFields).toEqual(["audience", "subject"]);
  });

  it("Signal Radar supports partial states gracefully", () => {
    const partial = signalRadarSchema.parse({
      status: "partial",
      summary: "Some signals found",
    });
    expect(partial.status).toBe("partial");
  });
});
