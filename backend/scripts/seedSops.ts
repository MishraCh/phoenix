import { getFirebaseDb } from "../src/config/firebaseAdmin.js";
import { seedExpertSopsForWorkspace } from "../src/ai/indexing/seedExpertSops.js";

async function run() {
  const db = getFirebaseDb();
  const workspaceId = "eIuA9HWU8QGOvCbv9N7l"; // The one from the logs
  console.log(`Seeding expert SOPs for workspace: ${workspaceId}`);
  const result = await seedExpertSopsForWorkspace(db, workspaceId);
  console.log("Done!", result);
  process.exit(0);
}

run().catch(console.error);
