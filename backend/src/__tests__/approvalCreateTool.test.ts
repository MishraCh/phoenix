import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";

import { getToolDefinition } from "../tools/toolRegistry.js";
import type { ToolExecutionContext } from "../tools/toolRegistry.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

function makeContext(fake: FakeFirestore): ToolExecutionContext {
  return {
    db: fake as unknown as Firestore,
    currentWorkspace: {
      id: "ws_test",
      workspace: { id: "ws_test", name: "Workspace" },
    },
    userId: "user_123",
  } as unknown as ToolExecutionContext;
}

function buildApprovalCreateTool(fake: FakeFirestore) {
  const def = getToolDefinition("approval.create");
  if (!def) throw new Error("approval.create not registered");
  return def.buildTool(makeContext(fake));
}

const baseInput = {
  title: "Create Xoidlabs company record",
  reason: "External CRM write",
  type: "crm_create" as const,
  preview: { company: "Xoidlabs" },
  actionType: "hubspot_create",
  riskLevel: "low" as const,
};

describe("approval.create generic tool (model-chosen target validation)", () => {
  it("rejects a model-invented toolName instead of creating a dead-end approval", async () => {
    const tool = buildApprovalCreateTool(new FakeFirestore());
    const result = (await tool.invoke({
      ...baseInput,
      toolName: "hubspot.createCompanyAndAssociate",
      input: { company: "Xoidlabs" },
    })) as { status: string; approvalId: string; message: string };

    expect(result.status).toBe("error");
    expect(result.approvalId).toBe("");
    // Suggestions must use the underscore-sanitized names the agent loop
    // actually exposes — the model checks its toolkit for the literal name.
    expect(result.message).toContain("hubspot_prepareCreateApproval");
  });

  it("rejects a real but non-approval-gated tool as target", async () => {
    const tool = buildApprovalCreateTool(new FakeFirestore());
    const result = (await tool.invoke({
      ...baseInput,
      toolName: "hubspot.readRecord",
      input: { module: "companies", recordId: "c1" },
    })) as { status: string };

    expect(result.status).toBe("error");
  });

  it("rejects input that does not match the target executor's schema", async () => {
    const tool = buildApprovalCreateTool(new FakeFirestore());
    const result = (await tool.invoke({
      ...baseInput,
      toolName: "hubspot.createApproved",
      input: { company: "Xoidlabs", fields_to_set: "Industry, Employee Count" },
    })) as { status: string; message: string };

    expect(result.status).toBe("error");
    expect(result.message).toContain("schema");
  });

  it("creates the approval for a valid executor target, escalating risk to the executor's level", async () => {
    const fake = new FakeFirestore();
    const tool = buildApprovalCreateTool(fake);
    const result = (await tool.invoke({
      ...baseInput,
      toolName: "hubspot.createApproved",
      input: { module: "companies", properties: { name: "Xoidlabs", industry: "AI" } },
    })) as { status: string; approvalId: string };

    expect(result.status).toBe("completed");
    expect(result.approvalId.length).toBeGreaterThan(0);

    const stored = fake.read(`workspaces/ws_test/approvals/${result.approvalId}`) as Record<string, any> | undefined;
    expect(stored?.proposedAction?.toolName).toBe("hubspot.createApproved");
    // model said "low" but the executor is high-risk — executor wins
    expect(stored?.riskLevel).toBe("high");
  });
});
