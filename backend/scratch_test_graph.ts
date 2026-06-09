import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as path from "path";
import fs from "fs";

import { CommandGraphService } from "./src/ai/graphs/commandGraph.js";

const keyPath = path.resolve(process.cwd(), "../service-account-key.json");
if (!fs.existsSync(keyPath)) {
  console.log("No key path, running without credential for emulator");
}
initializeApp({ projectId: "gideon-ai-local" });

const db = getFirestore();

async function run() {
  const workspaces = await db.collection("workspaces").limit(1).get();
  if (workspaces.empty) {
      console.log("No workspaces found");
      return;
  }
  const wid = workspaces.docs[0].id;
  const currentWorkspace = {
      id: wid,
      workspace: workspaces.docs[0].data() as any,
      role: "owner" as const,
      member: { role: "owner" as const, status: "active" as const } as any,
  };
  
  const service = new CommandGraphService(db);
  const result = await service.run({
      input: "Research the current market trends in Artificial Intelligence",
      mode: "research",
      userId: "test_user_id",
      currentWorkspace,
      sessionId: "test_session_123",
      sessionContext: "",
  });
  
  console.log("Graph result sourceRefs:", result.sourceRefs);
  console.log("Graph result sources:", (result as any).sources);
}

run().catch(console.error);
