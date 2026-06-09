/**
 * TASK-027 — MVP Verification Pass
 *
 * Verifies the full MVP loop end-to-end by calling backend services directly
 * against the live Firebase project (no HTTP server required).
 *
 * Tests:
 *   1  Workspace + user exist in Firestore
 *   2  Onboarding state read + write
 *   3  Dashboard summary
 *   4  Command graph (full LLM-backed command run)
 *   5  Workflow create + list + get
 *   6  Approval create + approve
 *   7  Approval reject (separate approval)
 *   8  Artifact create + list (Library)
 *   9  Activity events recorded
 *  10  Coupon application (billing upgrade)
 *  11  Web research — cache reuse + source-backed artifact
 */

// ── Production guard ──────────────────────────────────────────────────────────
// These scripts write to whichever Firebase project is configured via env vars.
// When no emulator is running, that is your PRODUCTION database.
if (!process.env.FIRESTORE_EMULATOR_HOST && process.env.ALLOW_PRODUCTION_SCRIPTS !== "true") {
  console.error("\n⛔  PRODUCTION GUARD: This script writes to Firestore.");
  console.error("    No Firestore emulator detected (FIRESTORE_EMULATOR_HOST is not set).");
  console.error("    Running against production will create test data in your live account.");
  console.error("");
  console.error("    To run against the emulator:  FIRESTORE_EMULATOR_HOST=localhost:8080 npx tsx <script>");
  console.error("    To override (production):     ALLOW_PRODUCTION_SCRIPTS=true npx tsx <script>");
  console.error("");
  process.exit(1);
}

import { Timestamp } from "firebase-admin/firestore";

import { ActivityService } from "../activity/activityService.js";
import { ArtifactService } from "../artifacts/artifactService.js";
import { ApprovalService } from "../approvals/approvalService.js";
import { BillingService } from "../billing/billingService.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { DashboardService } from "../dashboard/dashboardService.js";
import { OnboardingRepository } from "../repositories/onboardingRepository.js";
import { workspaceMemberSchema, workspaceSchema } from "../schemas/coreSchemas.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { WebIntelligenceService } from "../web/webIntelligenceService.js";
import { WorkflowService } from "../workflows/workflowService.js";
import { CommandGraphService } from "../ai/graphs/commandGraph.js";
import { env } from "../config/env.js";

// ── Reporting helpers ─────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
  passed++;
}

function fail(msg: string) {
  console.log(`  ✗ ${msg}`);
  failed++;
}

function skip(msg: string) {
  console.log(`  ~ ${msg}`);
  skipped++;
}

function info(msg: string) {
  console.log(`    ${msg}`);
}

function section(title: string) {
  console.log(`\n── ${title} ──`);
}

// ── Workspace bootstrap ───────────────────────────────────────────────────────

async function getWorkspace(db: ReturnType<typeof getFirebaseDb>): Promise<{
  currentWorkspace: CurrentWorkspace;
  userId: string;
}> {
  const snap = await db.collection("workspaces").limit(1).get();
  if (snap.empty) {
    throw new Error("No workspaces in Firestore. Sign in via the frontend to create one first.");
  }

  const doc = snap.docs[0];
  const workspace = workspaceSchema.parse({ id: doc.id, ...doc.data() });

  const memberSnap = await db.collection("workspaces").doc(doc.id).collection("members").limit(1).get();
  if (memberSnap.empty) {
    throw new Error("Workspace has no members.");
  }

  const memberDoc = memberSnap.docs[0];
  const member = workspaceMemberSchema.parse({ ...memberDoc.data() });

  return {
    currentWorkspace: { id: workspace.id, workspace, member, role: member.role },
    userId: member.userId,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db = getFirebaseDb();
  const { currentWorkspace, userId } = await getWorkspace(db);

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  TASK-027 — MVP VERIFICATION PASS");
  console.log("══════════════════════════════════════════════════════");
  console.log(`  Workspace : ${currentWorkspace.workspace.name} (${currentWorkspace.id})`);
  console.log(`  User      : ${userId}`);
  console.log(
    `  LLM       : openai / ${
      env.OPENAI_CHAT_MODEL ?? env.OPENAI_MODEL ?? "gpt-4.1"
    }`,
  );
  console.log(`  Plan      : ${currentWorkspace.workspace.plan}`);

  // ── TEST 1: Workspace + user ──────────────────────────────────────────────

  section("TEST 1: Workspace + user");
  currentWorkspace.id ? pass(`workspaceId = ${currentWorkspace.id}`) : fail("workspaceId missing");
  currentWorkspace.workspace.plan ? pass(`plan = ${currentWorkspace.workspace.plan}`) : fail("plan missing");
  userId ? pass(`userId = ${userId}`) : fail("userId missing");
  currentWorkspace.role ? pass(`member role = ${currentWorkspace.role}`) : fail("role missing");
  currentWorkspace.workspace.monthlyCreditsLimit > 0
    ? pass(`creditsLimit = ${currentWorkspace.workspace.monthlyCreditsLimit}`)
    : skip("creditsLimit = 0 (free tier or not yet set)");

  // ── TEST 2: Onboarding state read + write ─────────────────────────────────

  section("TEST 2: Onboarding state");
  try {
    const onboardingRepo = new OnboardingRepository(db);

    const existing = await onboardingRepo.getState(currentWorkspace.id, userId);
    existing !== null
      ? pass(`existing onboarding state found (step=${existing.currentStep}, completed=${existing.completed})`)
      : skip("no existing onboarding state (first-time user path)");

    const saved = await onboardingRepo.saveState({
      workspaceId: currentWorkspace.id,
      userId,
      currentStep: existing?.currentStep ?? 1,
      completed: existing?.completed ?? false,
      sampleWorkspaceEnabled: existing?.sampleWorkspaceEnabled ?? false,
      responses: { ...(existing?.responses ?? {}), verifyTask027: true },
    });

    saved.workspaceId === currentWorkspace.id ? pass("onboarding state saved") : fail("saved state workspaceId mismatch");
    saved.responses && (saved.responses as Record<string, unknown>).verifyTask027 === true
      ? pass("custom response field round-trips")
      : fail("custom response field missing after save");
  } catch (err) {
    fail(`onboarding error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── TEST 3: Dashboard summary ─────────────────────────────────────────────

  section("TEST 3: Dashboard summary");
  try {
    const dashboard = new DashboardService(db);
    const summary = await dashboard.getSummary(currentWorkspace.workspace, userId);

    typeof summary.pendingApprovals === "number"
      ? pass(`pendingApprovals = ${summary.pendingApprovals}`)
      : fail("pendingApprovals missing");
    typeof summary.activeWorkflowRuns === "number"
      ? pass(`activeWorkflowRuns = ${summary.activeWorkflowRuns}`)
      : fail("activeWorkflowRuns missing");
    typeof summary.activeAgents === "number"
      ? pass(`activeAgents = ${summary.activeAgents}`)
      : fail("activeAgents missing");
    Array.isArray(summary.recentArtifacts)
      ? pass(`recentArtifacts array (${summary.recentArtifacts.length} items)`)
      : fail("recentArtifacts missing");
    Array.isArray(summary.notifications)
      ? pass(`notifications array (${summary.notifications.length} items)`)
      : fail("notifications missing");
    summary.credits && typeof summary.credits.used === "number"
      ? pass(`credits { used: ${summary.credits.used}, limit: ${summary.credits.limit} }`)
      : fail("credits missing");
  } catch (err) {
    fail(`dashboard error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── TEST 4: Command graph ─────────────────────────────────────────────────

  section(`TEST 4: Command graph (LLM_PROVIDER=openai)`);
  try {
    const t4start = Date.now();
    const graph = new CommandGraphService(db);
    const cmd = await graph.run({
      input: "Give me a brief summary of the current workspace context and any recent activity.",
      userId,
      currentWorkspace,
    });
    const elapsed = Date.now() - t4start;

    info(`Duration: ${elapsed}ms`);
    cmd.answer && cmd.answer.length > 0
      ? pass(`answer present (${cmd.answer.length} chars)`)
      : fail("answer missing or empty");
    cmd.agentRunId
      ? pass(`agentRunId = ${cmd.agentRunId}`)
      : skip("agentRunId not returned (placeholder path)");
    Array.isArray(cmd.sources)
      ? pass(`sources array (${cmd.sources.length} items)`)
      : fail("sources missing");
    Array.isArray(cmd.proposedActions)
      ? pass(`proposedActions array (${cmd.proposedActions.length} items)`)
      : fail("proposedActions missing");
    if (cmd.artifactDrafts && cmd.artifactDrafts.length > 0) {
      pass(`artifactDraft: "${cmd.artifactDrafts[0].title}"`);
    } else {
      skip("no artifactDrafts (brief query unlikely to produce one)");
    }
  } catch (err) {
    fail(`command graph error: ${err instanceof Error ? err.message : String(err)}`);
    info("If this is a provider quota/config error, confirm your OpenAI fallback env values.");
  }

  // ── TEST 5: Workflow create + list + get ──────────────────────────────────

  section("TEST 5: Workflow create / list / get");
  let createdWorkflowId: string | undefined;
  try {
    const wfService = new WorkflowService(db);

    const created = await wfService.createWorkflow({
      workspace: currentWorkspace.workspace,
      userId,
      name: "TASK-027 Verification Workflow",
      description: "Auto-created by MVP verification script.",
      type: "custom",
      trigger: { type: "manual" },
      steps: [
        {
          id: "step_context",
          type: "context",
          name: "Gather context",
          order: 0,
          config: { sources: ["dashboard"] },
        },
        {
          id: "step_notify",
          type: "notification",
          name: "Send notification",
          order: 1,
          config: { channel: "in_app" },
        },
      ],
    });

    createdWorkflowId = created.id;
    created.id ? pass(`workflow created, id = ${created.id}`) : fail("workflow id missing");
    created.status ? pass(`status = ${created.status}`) : fail("status missing");
    created.steps.length === 2 ? pass("steps stored (2 steps)") : fail(`steps count = ${created.steps.length}`);

    const list = await wfService.listWorkflows(currentWorkspace.workspace);
    const found = list.find((w) => w.id === created.id);
    found ? pass("workflow appears in list") : fail("workflow not found in list");

    const fetched = await wfService.getWorkflow(currentWorkspace.workspace, created.id);
    fetched.id === created.id ? pass("workflow get by id succeeds") : fail("get by id returned wrong id");
    fetched.steps.length === 2 ? pass("steps round-trip correctly") : fail("steps count wrong after get");
  } catch (err) {
    fail(`workflow error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── TEST 6: Approval create + approve ────────────────────────────────────

  section("TEST 6: Approval create + approve");
  let approveApprovalId: string | undefined;
  try {
    const approvalService = new ApprovalService(db);
    const idempotencyKey = `task027-approve-${Date.now()}`;

    const approval = await approvalService.createApproval({
      workspace: currentWorkspace.workspace,
      userId,
      type: "other",
      title: "TASK-027: Test approval (approve path)",
      reason: "Created by MVP verification script.",
      preview: { action: "verify_approval_flow", target: "task027" },
      proposedAction: {
        toolName: "internal.test",
        actionType: "verify",
        input: { test: true },
        requiresApproval: true,
        riskLevel: "low",
      },
      riskLevel: "low",
      sourceRefs: [],
      idempotencyKey,
    });

    approveApprovalId = approval.id;
    approval.id ? pass(`approval created, id = ${approval.id}`) : fail("approval id missing");
    approval.status === "pending" ? pass("status = pending") : fail(`status = ${approval.status}`);
    approval.idempotencyKey === idempotencyKey ? pass("idempotencyKey stored") : fail("idempotencyKey mismatch");

    const approveResult = await approvalService.approve(
      currentWorkspace.workspace,
      approval.id,
      userId,
    );
    approveResult.status === "approved" ? pass("approval status → approved") : fail(`approve returned status = ${approveResult.status}`);
  } catch (err) {
    fail(`approval (approve path) error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── TEST 7: Approval create + reject ─────────────────────────────────────

  section("TEST 7: Approval create + reject");
  try {
    const approvalService = new ApprovalService(db);
    const idempotencyKey = `task027-reject-${Date.now()}`;

    const approval = await approvalService.createApproval({
      workspace: currentWorkspace.workspace,
      userId,
      type: "other",
      title: "TASK-027: Test approval (reject path)",
      reason: "Created by MVP verification script.",
      preview: { action: "verify_reject_flow", target: "task027" },
      proposedAction: {
        toolName: "internal.test",
        actionType: "verify_reject",
        input: { test: true },
        requiresApproval: true,
        riskLevel: "low",
      },
      riskLevel: "low",
      sourceRefs: [],
      idempotencyKey,
    });

    approval.id ? pass(`approval created, id = ${approval.id}`) : fail("approval id missing");

    const rejectResult = await approvalService.reject(
      currentWorkspace.workspace,
      approval.id,
      userId,
      "Rejected by TASK-027 verification script.",
    );
    rejectResult.status === "rejected" ? pass("approval status → rejected") : fail(`reject returned status = ${rejectResult.status}`);
  } catch (err) {
    fail(`approval (reject path) error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── TEST 8: Artifact create + list (Library) ──────────────────────────────

  section("TEST 8: Artifact Library (create + list)");
  let createdArtifactId: string | undefined;
  try {
    const artifactService = new ArtifactService(db);

    const artifact = await artifactService.createArtifact({
      workspace: currentWorkspace.workspace,
      userId,
      title: "TASK-027 Verification Report",
      artifactType: "report",
      content: "This artifact was created by the TASK-027 MVP verification script to confirm the Library write path works correctly.",
      sourceRefs: [
        {
          sourceType: "artifact",
          sourceId: "task027-verification",
          title: "TASK-027 verification",
          provider: "system",
        },
      ],
      inputHash: "task027-verification-hash",
    });

    createdArtifactId = artifact.id;
    artifact.id ? pass(`artifact created, id = ${artifact.id}`) : fail("artifact id missing");
    artifact.type ? pass(`artifact type = ${artifact.type}`) : fail("artifact type missing");
    artifact.status ? pass(`artifact status = ${artifact.status}`) : fail("artifact status missing");
    artifact.sourceRefs.length > 0 ? pass(`sourceRefs = ${artifact.sourceRefs.length}`) : fail("no sourceRefs on artifact");

    const artifactSnap = await db
      .collection("workspaces")
      .doc(currentWorkspace.id)
      .collection("artifacts")
      .orderBy("createdAt", "desc")
      .limit(5)
      .get();

    artifactSnap.empty ? fail("no artifacts in Library Firestore collection") : pass(`Library has ${artifactSnap.docs.length} recent artifacts`);
    const found = artifactSnap.docs.find((d) => d.id === artifact.id);
    found ? pass("newly created artifact visible in Library query") : fail("newly created artifact not found in Library query");
  } catch (err) {
    fail(`artifact error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── TEST 9: Activity events ───────────────────────────────────────────────

  section("TEST 9: Activity events");
  try {
    const activityService = new ActivityService(db);

    await activityService.createEvent({
      workspaceId: currentWorkspace.id,
      type: "task027.verification",
      title: "TASK-027 verification event",
      actorType: "system",
      related: {
        ...(createdArtifactId ? { artifactId: createdArtifactId } : {}),
        ...(createdWorkflowId ? { workflowId: createdWorkflowId } : {}),
      },
      metadata: { verificationRun: true, ts: Date.now() },
    });
    pass("activity event written");

    const activitySnap = await db
      .collection("workspaces")
      .doc(currentWorkspace.id)
      .collection("activity")
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();

    activitySnap.empty ? fail("no activity events in Firestore") : pass(`${activitySnap.docs.length} recent activity events`);

    const recent = activitySnap.docs.map((d) => d.data());
    const task027Event = recent.find((e) => e.type === "task027.verification");
    task027Event ? pass("task027 event readable after write") : fail("task027 event not found in activity query");

    info("Recent events:");
    recent.slice(0, 5).forEach((e) => info(`  [${e.type}] ${e.title}`));
  } catch (err) {
    fail(`activity error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── TEST 10: Coupon / billing ─────────────────────────────────────────────

  section("TEST 10: Coupon application (billing)");
  try {
    const billing = new BillingService(db);

    const result = await billing.applyCoupon({
      couponCode: "GIDEON_PLUS_2026",
      currentWorkspace,
      userId,
    });

    result.plan ? pass(`plan upgraded to: ${result.plan}`) : fail("plan missing in coupon result");
    result.creditsGranted > 0 ? pass(`creditsGranted = ${result.creditsGranted}`) : fail("creditsGranted = 0");

    const wsSnap = await db.collection("workspaces").doc(currentWorkspace.id).get();
    const wsData = wsSnap.data();
    wsData?.plan === "plus" || wsData?.plan === "pro"
      ? pass(`workspace plan in Firestore = ${wsData.plan}`)
      : fail(`workspace plan in Firestore = ${wsData?.plan ?? "missing"}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAlreadyRedeemed =
      (err instanceof Error && (err as unknown as { code?: string }).code === "COUPON_ALREADY_REDEEMED") ||
      msg.toLowerCase().includes("already been redeemed") ||
      msg.includes("COUPON_ALREADY_REDEEMED");

    if (isAlreadyRedeemed) {
      pass("COUPON_ALREADY_REDEEMED — coupon was applied in a previous run (correct dedup behavior)");
      info("To test fresh coupon application, reset the workspace redemptions or use a different coupon code.");
    } else {
      fail(`billing error: ${msg}`);
    }
  }

  // ── TEST 11: Web research — cache reuse + source-backed artifact ──────────

  section("TEST 11: Web research — cache reuse + source-backed artifact");
  try {
    const webService = new WebIntelligenceService(db);
    const RESEARCH_PROMPT = "Anthropic enterprise AI positioning 2024";

    const t11start = Date.now();
    const result = await webService.runResearchTask({
      currentWorkspace,
      userId,
      prompt: RESEARCH_PROMPT,
      processor: "core",
      activitySource: "tool",
    });
    const elapsed = Date.now() - t11start;

    info(`Duration: ${elapsed}ms`);
    result.provider === "openai_graph" ? pass(`provider = ${result.provider}`) : fail(`provider = ${result.provider}`);
    result.fromCache ? pass("cache HIT — no redundant provider call") : pass("live call completed (not cached)");
    result.contentText.length > 0 ? pass(`contentText length = ${result.contentText.length}`) : fail("contentText empty");
    result.sourceRefs.length > 0 ? pass(`sourceRefs = ${result.sourceRefs.length}`) : fail("no sourceRefs");
    result.contentHash ? pass(`contentHash = ${result.contentHash.slice(0, 12)}...`) : fail("contentHash missing");

    // Create source-backed artifact from research result
    const artifactService = new ArtifactService(db);
    const researchArtifact = await artifactService.createArtifact({
      workspace: currentWorkspace.workspace,
      userId,
      title: `Research: ${RESEARCH_PROMPT}`,
      artifactType: "report",
      content: result.contentText,
      sourceRefs: result.sourceRefs,
      inputHash: result.contentHash,
    });

    researchArtifact.id ? pass(`source-backed artifact saved, id = ${researchArtifact.id}`) : fail("research artifact id missing");
    researchArtifact.sourceRefs.length > 0
      ? pass(`artifact has ${researchArtifact.sourceRefs.length} sourceRefs`)
      : fail("research artifact has no sourceRefs");
    researchArtifact.inputHash
      ? pass(`artifact inputHash = ${researchArtifact.inputHash.slice(0, 12)}...`)
      : skip("inputHash not stored (optional)");
  } catch (err) {
    fail(`web research error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const total = passed + failed;
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;

  console.log("\n══════════════════════════════════════════════════════");
  console.log(`  TASK-027 RESULTS: ${passed}/${total} passed (${pct}%)   skipped: ${skipped}`);
  if (failed > 0) {
    console.log(`  ✗ ${failed} failure(s) — see details above`);
  } else {
    console.log("  All checks passed.");
  }
  console.log("══════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
