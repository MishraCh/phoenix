import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { IntegrationWorkspaceService } from "../integrations/integrationWorkspaceService.js";
import { HubSpotProvider } from "../integrations/providers/hubspot/hubspotProvider.js";
import type { Integration } from "../schemas/coreSchemas.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

function asDb(fake: FakeFirestore) {
  return fake as unknown as Firestore;
}

function currentWorkspace(): CurrentWorkspace {
  const now = Timestamp.now();
  return {
    id: "ws_test",
    workspace: {
      id: "ws_test",
      name: "Workspace",
      ownerId: "user_owner",
      plan: "pro",
      planSource: "manual",
      channelsConfig: { emailEnabled: false, whatsappEnabled: false },
      monthlyCreditsLimit: 100,
      monthlyCreditsUsed: 0,
      billingCycleStartAt: now,
      createdAt: now,
      updatedAt: now,
    },
    role: "owner",
  } as unknown as CurrentWorkspace;
}

function seedHubSpotConnection(fake: FakeFirestore): Integration {
  const now = Timestamp.now();
  const integration = {
    id: "hubspot",
    workspaceId: "ws_test",
    provider: "hubspot",
    status: "connected",
    scopes: [],
    scopesGranted: [],
    tokenRef: "workspaces/ws_test/integrations/hubspot",
    capabilities: ["crm.read", "crm.write"],
    syncError: null,
    connectedBy: "user_owner",
    ownedByUserId: "user_owner",
    syncStatus: "idle",
    createdAt: now,
    updatedAt: now,
  } satisfies Record<string, unknown>;
  fake.seed("workspaces/ws_test/integrations/hubspot", integration);
  return integration as unknown as Integration;
}

describe("HubSpot bulk write (batch approval)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("prepareHubSpotBulkWriteApproval builds ONE approval listing all rows", async () => {
    const fake = new FakeFirestore();
    seedHubSpotConnection(fake);
    const service = new IntegrationWorkspaceService(asDb(fake));

    const result = await service.prepareHubSpotBulkWriteApproval(currentWorkspace(), "user_owner", {
      module: "companies",
      records: [{ properties: { name: "Acme AI" } }, { recordId: "co_2", properties: { industry: "SaaS" } }],
    });

    expect(result.rowCount).toBe(2);
    const approval = fake.read(`workspaces/ws_test/approvals/${result.approvalId}`);
    expect(approval?.["type"]).toBe("crm_bulk");
    expect(approval?.["proposedAction"]).toMatchObject({ toolName: "hubspot.bulkWriteApproved", actionType: "hubspot_bulk_write" });
    const preview = approval?.["preview"] as { rows: Array<{ op: string }> };
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0].op).toBe("create");
    expect(preview.rows[1].op).toBe("update");
  });

  it("rejects a create row missing required identity fields", async () => {
    const fake = new FakeFirestore();
    seedHubSpotConnection(fake);
    const service = new IntegrationWorkspaceService(asDb(fake));
    await expect(
      service.prepareHubSpotBulkWriteApproval(currentWorkspace(), "user_owner", {
        module: "companies",
        records: [{ properties: { industry: "SaaS" } }], // no name/domain on a create
      }),
    ).rejects.toThrow();
  });

  it("executeApprovedHubSpotBulkWrite loops create/update and reports per-row results incl. failures", async () => {
    const fake = new FakeFirestore();
    seedHubSpotConnection(fake);
    vi.spyOn(HubSpotProvider.prototype, "getConnectionStatus").mockResolvedValue({ status: "connected" });
    vi.spyOn(HubSpotProvider.prototype, "createRecord").mockResolvedValue({ id: "new_1", properties: { name: "Acme AI" } });
    vi.spyOn(HubSpotProvider.prototype, "updateRecord")
      .mockResolvedValueOnce({ id: "co_2", properties: { industry: "SaaS" } })
      .mockRejectedValueOnce(new Error("HubSpot 400"));

    const service = new IntegrationWorkspaceService(asDb(fake));
    const result = await service.executeApprovedHubSpotBulkWrite(currentWorkspace(), "user_owner", {
      module: "companies",
      records: [
        { properties: { name: "Acme AI" } },
        { recordId: "co_2", properties: { industry: "SaaS" } },
        { recordId: "co_3", properties: { industry: "AI" } },
      ],
    });

    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results).toHaveLength(3);
    expect(result.results[2]).toMatchObject({ op: "update", recordId: "co_3", status: "failed" });
  });
});
