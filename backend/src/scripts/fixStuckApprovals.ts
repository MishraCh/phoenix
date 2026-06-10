import "dotenv/config";

import { Timestamp } from "firebase-admin/firestore";

import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { getToolDefinition } from "../tools/toolRegistry.js";

/**
 * One-off cleanup: approvals stuck in "approved" whose proposedAction.toolName
 * is not a registered executor can never execute, retry, or be rejected from
 * the UI. Mark them failed with an actionable reason.
 *
 * Usage: npx tsx src/scripts/fixStuckApprovals.ts
 */
async function main() {
  const db = getFirebaseDb();
  // Per-workspace queries use Firestore's automatic single-field indexes —
  // a collectionGroup query here would require a composite index.
  const workspaces = await db.collection("workspaces").get();
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const ws of workspaces.docs) {
    const snapshot = await ws.ref.collection("approvals").where("status", "==", "approved").get();
    docs.push(...snapshot.docs);
  }
  console.log(`Found ${docs.length} approval(s) in status "approved" across ${workspaces.size} workspace(s).`);

  let fixed = 0;
  for (const doc of docs) {
    const data = doc.data() as { title?: string; proposedAction?: { toolName?: string } };
    const toolName = data.proposedAction?.toolName ?? "";
    if (getToolDefinition(toolName)) {
      console.log(`- skip ${doc.id} ("${data.title}") — tool "${toolName}" is executable`);
      continue;
    }
    const now = Timestamp.now();
    await doc.ref.update({
      status: "failed",
      executionStatus: "failed",
      executionCompletedAt: now,
      error: `This approval references "${toolName}", which is not an executable action. Ask Gideon to propose the action again.`,
      updatedAt: now,
    });
    fixed += 1;
    console.log(`- fixed ${doc.id} ("${data.title}") — unknown tool "${toolName}" -> failed`);
  }
  console.log(`Done. ${fixed} approval(s) marked failed.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
