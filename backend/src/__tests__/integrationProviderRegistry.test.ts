import { describe, expect, it } from "vitest";

import { normalizeIntegrationProviderId } from "../integrations/providers/providerRegistry.js";

describe("normalizeIntegrationProviderId", () => {
  it("maps legacy google provider ids to gmail", () => {
    expect(normalizeIntegrationProviderId("google")).toBe("gmail");
  });

  it("keeps hubspot as hubspot", () => {
    expect(normalizeIntegrationProviderId("hubspot")).toBe("hubspot");
  });
});
