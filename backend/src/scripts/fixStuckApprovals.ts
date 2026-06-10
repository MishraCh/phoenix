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
  const snapshot = await db.collectionGroup("approvals").where("status", "==", "approved").get();
  console.log(`Found ${snapshot.size} approval(s) in status "approved".`);

  let fixed = 0;
  for (const doc of snapshot.docs) {
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
