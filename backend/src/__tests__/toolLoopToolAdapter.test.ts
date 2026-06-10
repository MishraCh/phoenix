import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const evaluateActionMock = vi.fn();
vi.mock("../policy/policyService.js", () => ({
  PolicyService: class {
    evaluateAction = evaluateActionMock;
  },
}));

import { adaptToolForAgent, filterToolsForAgent } from "../ai/agentic/toolLoopToolAdapter.js";

function makeToolDef(over: Record<string, any> = {}) {
  const invoke = vi.fn().mockResolvedValue({ ok: true });
  return {
    def: {
      name: over.name ?? "web.researchTask",
      description: "Research the web",
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({}).passthrough(),
      permissionsRequired: [],
      capabilitiesRequired: [],
      riskLevel: over.riskLevel ?? "low",
      requiresApproval: over.requiresApproval ?? false,
      idempotencyRequired: false,
      exposedToPlanner: over.exposedToPlanner,
      buildTool: () => ({ name: over.name ?? "web.researchTask", description: "d", schema: z.object({}), invoke }),
    },
    invoke,
  };
}

const ctx = { db: {}, currentWorkspace: { workspace: { id: "w1" } }, userId: "u1" } as any;

describe("toolLoopToolAdapter", () => {
  beforeEach(() => evaluateActionMock.mockReset());

  it("filterToolsForAgent drops exposedToPlanner === false and respects allowlist", () => {
    const read = makeToolDef({ name: "web.researchTask" }).def;
    const hidden = makeToolDef({ name: "hubspot.updateApproved", exposedToPlanner: false }).def;
    const other = makeToolDef({ name: "gmail.searchThreads" }).def;
    const filtered = filterToolsForAgent([read, hidden, other], ["web.researchTask"]);
    expect(filtered.map((t) => t.name)).toEqual(["web.researchTask"]);
  });

  it("invokes the underlying tool when policy allows", async () => {
    evaluateActionMock.mockReturnValue({ status: "allowed", requiresApproval: false, reason: "" });
    const { def, invoke } = makeToolDef();
    const aiTool = adaptToolForAgent(def, ctx);
    const exec = aiTool.execute as (i: unknown) => Promise<unknown>;
    const result = await exec({ prompt: "x" });
    expect(invoke).toHaveBeenCalledWith({ prompt: "x" });
    expect(result).toEqual({ ok: true });
  });

  it("does NOT invoke write-EXECUTING tools (requiresApproval: true) when policy requires approval", async () => {
    evaluateActionMock.mockReturnValue({ status: "approval_required", requiresApproval: true, reason: "needs approval" });
    const { def, invoke } = makeToolDef({ name: "hubspot.updateApproved", riskLevel: "high", requiresApproval: true });
    const aiTool = adaptToolForAgent(def, ctx);
    const exec = aiTool.execute as (i: unknown) => Promise<unknown>;
    const result = (await exec({ prompt: "x" })) as { status: string };
    expect(invoke).not.toHaveBeenCalled();
    expect(result.status).toBe("approval_required");
  });

  it("DOES invoke high-risk prepare*Approval tools — they ARE the approval mechanism", async () => {
    // Policy marks high-risk actions approval_required, but the prepare tool only
    // creates the approval draft (requiresApproval: false) — it must run.
    evaluateActionMock.mockReturnValue({ status: "approval_required", requiresApproval: true, reason: "high risk action" });
    const { def, invoke } = makeToolDef({ name: "hubspot.prepareCreateApproval", riskLevel: "high", requiresApproval: false });
    const aiTool = adaptToolForAgent(def, ctx);
    const exec = aiTool.execute as (i: unknown) => Promise<unknown>;
    const result = await exec({ prompt: "x" });
    expect(invoke).toHaveBeenCalledWith({ prompt: "x" });
    expect(result).toEqual({ ok: true });
  });

  it("does NOT invoke and returns blocked when policy blocks", async () => {
    evaluateActionMock.mockReturnValue({ status: "blocked", requiresApproval: false, reason: "viewer cannot write" });
    const { def, invoke } = makeToolDef();
    const aiTool = adaptToolForAgent(def, ctx);
    const exec = aiTool.execute as (i: unknown) => Promise<unknown>;
    const result = (await exec({ prompt: "x" })) as { status: string };
    expect(invoke).not.toHaveBeenCalled();
    expect(result.status).toBe("blocked");
  });
});
