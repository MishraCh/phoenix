import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

import { integrationSchema } from "../schemas/coreSchemas.js";

describe("integrationSchema status mapping", () => {
  const now = Timestamp.now();

  it("maps legacy needs_reconnect to reconnect_needed", () => {
    const parsed = integrationSchema.parse({
      id: "gmail",
      workspaceId: "ws_123",
      provider: "gmail",
      status: "needs_reconnect",
      scopes: [],
      capabilities: [],
      connectedBy: "user_123",
      createdAt: now,
      updatedAt: now,
    });

    expect(parsed.status).toBe("reconnect_needed");
  });

  it("maps legacy disabled to disconnected", () => {
    const parsed = integrationSchema.parse({
      id: "hubspot",
      workspaceId: "ws_123",
      provider: "hubspot",
      status: "disabled",
      scopes: [],
      capabilities: [],
      connectedBy: "user_123",
      createdAt: now,
      updatedAt: now,
    });

    expect(parsed.status).toBe("disconnected");
  });
});
