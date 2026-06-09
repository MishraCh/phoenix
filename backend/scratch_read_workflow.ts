import fs from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const envStr = fs.readFileSync(".env", "utf8");
const projectIdMatch = envStr.match(/GIDEON_FIREBASE_PROJECT_ID=(.*)/);
const clientEmailMatch = envStr.match(/GIDEON_FIREBASE_CLIENT_EMAIL=(.*)/);
const privateKeyMatch = envStr.match(/GIDEON_FIREBASE_PRIVATE_KEY="(.*)"/s) || envStr.match(/GIDEON_FIREBASE_PRIVATE_KEY=(.*)/);

const serviceAccount = {
  projectId: projectIdMatch ? projectIdMatch[1].trim() : "",
  clientEmail: clientEmailMatch ? clientEmailMatch[1].trim() : "",
  privateKey: privateKeyMatch ? privateKeyMatch[1].replace(/\\n/g, '\n') : ""
};

// Initialize Firebase Admin
initializeApp({
  credential: cert(serviceAccount)
});
const db = getFirestore();

async function checkWorkflow() {
  const workspaceId = "eIuA9HWU8QGOvCbv9N7l"; // From logs: auth.defaultWorkspaceId
  const workflowId = "LFAyuCsxFru2Q0LiET45"; // From logs

  const doc = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("workflows")
    .doc(workflowId)
    .get();

  if (!doc.exists) {
    console.log("Workflow not found");
    return;
  }

  const data = doc.data();
  console.log(JSON.stringify(data.steps, null, 2));
}

checkWorkflow().catch(console.error);
