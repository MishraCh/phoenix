import { describe, it, expect } from "vitest";
import { mapEnrichment } from "../integrations/providers/hubspot/crmFieldMap.js";

describe("mapEnrichment", () => {
  it("maps known company concepts to HubSpot properties; unknowns go to unmapped", () => {
    const { properties, unmapped } = mapEnrichment("companies", {
      industry: "SaaS",
      employees: 200,
      website: "https://acme.ai",
      foundedYear: 2019,
    });
    expect(properties).toEqual({ industry: "SaaS", numberofemployees: 200, domain: "https://acme.ai" });
    expect(unmapped).toEqual({ foundedYear: 2019 });
  });

  it("maps contact concepts (case-insensitive keys) to HubSpot properties", () => {
    const { properties } = mapEnrichment("contacts", {
      Email: "jane@acme.ai",
      Title: "CEO",
      "first name": "Jane",
      phone: "+1-555",
    });
    expect(properties).toEqual({ email: "jane@acme.ai", jobtitle: "CEO", firstname: "Jane", phone: "+1-555" });
  });

  it("drops null/empty values", () => {
    const { properties } = mapEnrichment("companies", { industry: "", domain: null });
    expect(properties).toEqual({});
  });
});
