import { getFirestore } from "firebase-admin/firestore";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";

const envStr = fs.readFileSync(".env", "utf-8");
const env: Record<string, string> = {};
for (const line of envStr.split("\n")) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    let val = match[2];
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/\\n/g, '\n');
    }
    env[match[1]] = val;
  }
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.GIDEON_FIREBASE_PROJECT_ID,
    clientEmail: env.GIDEON_FIREBASE_CLIENT_EMAIL,
    privateKey: env.GIDEON_FIREBASE_PRIVATE_KEY,
  }),
});
const db = getFirestore();

async function run() {
  const docs = await db.collection("workspaces").doc("eIuA9HWU8QGOvCbv9N7l").collection("artifacts").limit(5).get();
  for (const doc of docs.docs) {
    console.log(doc.id, doc.data().title);
    console.log(doc.data().textContent?.slice(0, 300));
  }
}

run().catch(console.error);
