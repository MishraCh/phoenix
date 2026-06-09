import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as path from "path";
import fs from "fs";

const keyPath = path.resolve(process.cwd(), "../service-account-key.json");
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore();

async function run() {
  const workspaces = await db.collection("workspaces").limit(1).get();
  if (workspaces.empty) {
      console.log("No workspaces found");
      return;
  }
  const wid = workspaces.docs[0].id;
  
  const sessions = await db.collection(`workspaces/${wid}/commandSessions`).orderBy("updatedAt", "desc").limit(1).get();
  if (sessions.empty) {
      console.log("No sessions found");
      return;
  }
  const sid = sessions.docs[0].id;
  
  const msgs = await db.collection(`workspaces/${wid}/commandSessions/${sid}/messages`).orderBy("createdAt", "desc").limit(1).get();
  if (msgs.empty) {
      console.log("No messages");
      return;
  }
  
  const msg = msgs.docs[0].data();
  console.log("Message responseJson length:", msg.responseJson?.length);
  console.log("Message responseJson:", msg.responseJson);
}

run().catch(console.error);
