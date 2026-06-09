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

import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { workspaceMemberSchema, workspaceSchema } from "../schemas/coreSchemas.js";
import { WebIntelligenceService } from "../web/webIntelligenceService.js";
import { CommandGraphService } from "../ai/graphs/commandGraph.js";

const RESEARCH_PROMPT = "Anthropic enterprise AI positioning 2024";
const EXTRACT_URL = "https://www.anthropic.com";
const COMMAND_INPUT = "Research Anthropic's current enterprise AI positioning and create a short sourced brief.";

function pass(msg: string) { console.log(`  ✓ ${msg}`); }
function fail(msg: string) { console.log(`  ✗ ${msg}`); }
function section(title: string) { console.log(`\n── ${title} ──`); }

async function getWorkspace(db: ReturnType<typeof getFirebaseDb>) {
  const snap = await db.collection("workspaces").limit(1).get();
  if (snap.empty) throw new Error("No workspaces in Firestore. Sign in via the app first to create one.");
  const doc = snap.docs[0];
  const workspace = workspaceSchema.parse({ id: doc.id, ...doc.data() });

  const memberSnap = await db.collection("workspaces").doc(doc.id).collection("members").limit(1).get();
  if (memberSnap.empty) throw new Error("Workspace has no members.");
  const memberDoc = memberSnap.docs[0];
  const member = workspaceMemberSchema.parse({ ...memberDoc.data() });

  return {
    currentWorkspace: { id: workspace.id, workspace, member, role: member.role },
    userId: member.userId,
  };
}

async function main() {
  const db = getFirebaseDb();
  const { currentWorkspace, userId } = await getWorkspace(db);

  console.log(`\nWorkspace: ${currentWorkspace.workspace.name} (${currentWorkspace.id})`);
  console.log(`User:      ${userId}`);

  const webService = new WebIntelligenceService(db);

  // ── TEST 1: Parallel Task (research) ──────────────────────────────────────
  section("TEST 1: Parallel Task — research query");
  const t1start = Date.now();
  const r1 = await webService.runResearchTask({
    currentWorkspace,
    userId,
    prompt: RESEARCH_PROMPT,
    processor: "core",
    activitySource: "tool",
  });
  console.log(`  Duration:    ${Date.now() - t1start}ms`);
  r1.provider === "parallel-task" ? pass(`provider = ${r1.provider}`) : fail(`provider = ${r1.provider}`);
  r1.fromCache === false ? pass("live call (not cached)") : pass("cache hit (already cached)");
  r1.contentText.length > 0 ? pass(`contentText length = ${r1.contentText.length}`) : fail("contentText empty");
  r1.sourceRefs.length > 0 ? pass(`sourceRefs = ${r1.sourceRefs.length}`) : fail("no sourceRefs");
  r1.citations.length > 0 ? pass(`citations = ${r1.citations.length}`) : console.log("  ~ citations = 0 (may be normal for this query)");
  console.log(`  contentHash: ${r1.contentHash.slice(0, 12)}...`);

  // ── TEST 2: Parallel Extract (URL) ────────────────────────────────────────
  section("TEST 2: Parallel Extract — URL extraction");
  const t2start = Date.now();
  const r2 = await webService.extractUrl({
    currentWorkspace,
    userId,
    urls: [EXTRACT_URL],
    activitySource: "tool",
  });
  console.log(`  Duration:    ${Date.now() - t2start}ms`);
  r2.provider === "parallel-extract" ? pass(`provider = ${r2.provider}`) : fail(`provider = ${r2.provider}`);
  r2.fromCache === false ? pass("live call (not cached)") : pass("cache hit (already cached)");
  r2.url ? pass(`url = ${r2.url}`) : fail("url missing");
  r2.excerpts.length > 0 ? pass(`excerpts = ${r2.excerpts.length}`) : fail("no excerpts");
  r2.contentText.length > 0 ? pass(`contentText length = ${r2.contentText.length}`) : fail("contentText empty");
  r2.sourceRefs.length > 0 ? pass(`sourceRefs = ${r2.sourceRefs.length}`) : fail("no sourceRefs");
  console.log(`  title:       ${r2.title ?? "(none)"}`);
  console.log(`  contentHash: ${r2.contentHash.slice(0, 12)}...`);

  // ── TEST 3: Cache reuse ───────────────────────────────────────────────────
  section("TEST 3: Cache reuse — repeat research query");
  const t3start = Date.now();
  const r3 = await webService.runResearchTask({
    currentWorkspace,
    userId,
    prompt: RESEARCH_PROMPT,
    processor: "core",
    activitySource: "tool",
  });
  console.log(`  Duration:    ${Date.now() - t3start}ms`);
  r3.fromCache ? pass("cache HIT — no provider call made") : fail("cache MISS — provider was called again");
  r3.contentHash === r1.contentHash ? pass("contentHash matches first run") : fail("contentHash mismatch");
  r3.sourceRefs.length === r1.sourceRefs.length ? pass("sourceRefs count matches") : fail("sourceRefs count differs");

  // ── TEST 4: Full command graph (webFetch → planner → write) ───────────────
  section("TEST 4: Full command graph — research intent");
  const t4start = Date.now();
  const graph = new CommandGraphService(db);
  const cmd = await graph.run({
    input: COMMAND_INPUT,
    userId,
    currentWorkspace,
  });
  console.log(`  Duration:    ${Date.now() - t4start}ms`);
  cmd.answer ? pass(`answer present (${cmd.answer.length} chars)`) : fail("answer missing");
  cmd.agentRunId ? pass(`agentRunId = ${cmd.agentRunId}`) : fail("agentRunId missing");
  cmd.sources.length > 0 ? pass(`sources = ${cmd.sources.length}`) : fail("no sources on response");

  if (cmd.artifactDrafts.length > 0) {
    pass(`artifactDraft: "${cmd.artifactDrafts[0].title}" (${cmd.artifactDrafts[0].artifactType})`);
    console.log(`  preview: ${cmd.artifactDrafts[0].previewText.slice(0, 120)}...`);
  } else {
    console.log("  ~ no artifactDraft in response (planner may not have created one)");
  }

  // ── TEST 5: Verify artifact in Firestore Library ──────────────────────────
  section("TEST 5: Library — artifact in Firestore");
  const artifactSnap = await db
    .collection("workspaces")
    .doc(currentWorkspace.id)
    .collection("artifacts")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();

  if (artifactSnap.empty) {
    fail("no artifacts in Library");
  } else {
    const art = artifactSnap.docs[0].data();
    pass(`artifact found: "${art.title}" (${art.type})`);
    Array.isArray(art.sourceRefs) && art.sourceRefs.length > 0
      ? pass(`sourceRefs on artifact = ${art.sourceRefs.length}`)
      : fail("artifact has no sourceRefs");
    art.status ? pass(`status = ${art.status}`) : fail("status missing");
    console.log(`  artifactId: ${art.id}`);
  }

  // ── Activity check ────────────────────────────────────────────────────────
  section("TEST 6: Activity events");
  const activitySnap = await db
    .collection("workspaces")
    .doc(currentWorkspace.id)
    .collection("activity")
    .orderBy("createdAt", "desc")
    .limit(5)
    .get();

  activitySnap.empty ? fail("no activity events") : pass(`${activitySnap.docs.length} recent activity events`);
  activitySnap.docs.forEach((doc) => {
    const ev = doc.data();
    console.log(`  [${ev.type}] ${ev.title}`);
  });

  console.log("\n══════════════════════════════════════════");
  console.log("  TASK-025 RUNTIME VERIFICATION COMPLETE");
  console.log("══════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
