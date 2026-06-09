import admin from 'firebase-admin';
import * as path from 'path';

// 1. Initialize Old App (Hardcoded to the old gideon-ai-81233 project)
const oldApp = admin.initializeApp({
  credential: admin.credential.cert({
    projectId: "gideon-ai-81233",
    clientEmail: "firebase-adminsdk-fbsvc@gideon-ai-81233.iam.gserviceaccount.com",
    privateKey: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDXvcE/u1P3gEWY\npPs5MDHAjRplT1+wNWbFxblzxedWp741zukNxdMQpGJwXjq/A3g2Un7ISHsuUdYX\nYH9e2yRE5JwE39hJ6pkJWdOY+PuUUFmJzjFiZxJcGNHGzw4rRHDvSMOUTiETY65q\nD1ORgZlD4tRf/H6tOtcZG0wtZI4NOVqtTpTH3MmYsEgQzhXHDToJf95EDClYX7PX\nyTncwiXFvh7OeKJyFIPM9R8fFxtlZt+xlX4HBZAT5+ORNH8zUZQ3qfN+fGzQQuxo\nRvGSlmTy1/0/S6kndhSvBFlbD43a1Yx29NDP3A/06UlkGebJJIKJQChJ1OcK0awu\naTgu9YxTAgMBAAECggEAAwiSgoxmQlkl4V8UfznbwTrar6j9jfM6RjahBG04cwH5\nzTTjFwP8k0PUdIMGrW/ljVH8oWFPhhe1fG+patKHAIb8YJ8rIeLwEu8V6BU8KFo2\n4BaroBgV7ICW1oZLyzTzp5Gs2lV85pJkve4IPUgGuSsj1FOvDk2A/8Pf/tVmn+3z\nZwflvgCYmR2WqpYOL/ZEHvUUyrBBRdk0izvD41BVHuamt5QbY4RX2uE0m+Wv97cY\nFvuB8nQ2cvpTIEwU+hy8wC7j4nB0D7jH0wgd/Q9S/X+3C2qrmTbleCF6kFf3ZVoc\nrUe7mGUE6i74D/KhRE4sdyd94GsNp2ClmY7q3FP3gQKBgQD5gRY8fefPwmnEGW7w\niqatfFciVFM7bbZN02Uhgbl02ReNg47WHX9/+4WfdGD47XY7bGbIMCsbNfMPwsV6\nMvZa0nc9ttFcmAqMnSPkrv+fo/apa/U3PaJQQ869HzEsuYaqyWABEmtvVlszHDNq\nnzjmm2pXIcRFh0JOIPy/lKSw0wKBgQDdW6RWGCKlvcbI0Gq8xnvqzhwp35i24ccn\nY3RQLE0M0GCqgmKDycCqlHCc8nFGnFDRQP0AlI1AuaBYSXHcP6MTW5MXMvJ1tbHD\ncJZ5UucupX/OBkF3XNdT5idjVSQK69PxiwTxCqOE69FjHiz9FagqWnhTeTRPKb6Z\n3PECDK6GgQKBgF4iO9d60TjraqgXyGlshlIx9VX4ZqanT/6w4RjxLp1NQrubhQp3\neqE4rkNozyVbwh3NWkHxGnJbumaZ35OpIpVFjsNz9C1xF5nRt7cR51O9stRc7Nl4\noYKS8q8b05vCK3LIIzaEUpBhDmuMGkIB7J/kxww0qy5oR7XecD1/wVsNAoGAHBaQ\n18vgOZ/HJZwsrx+Qgc79i+KvgiVMHBdmnvXAISwf2AMLdSWYqQyE7aVl8kvLhYH1\nmKlA80Gasxk+tW/txXsNQxhX48/WarJSpbp7U1P0z7PDgt3pBOBjhxs6o5ghILk/\nO0baUPeLbkRZ+RNSb21jb1Ql6xWk9ekvO89YJgECgYEA3PCV9z4cmU1OpVRCBBFP\nxgmBa1RKnqK3KRkOrtsdbOjkO28MRcTnGXsroR4twBIqg5ilRjlhpmGR+P6WXkji\nhgy5BytlF0EmdN89dHu9mPV0TriETlRh112gbakV8qkKQt4m/YH5QYPSWgWOTWdm\nwoWXhi3hu8t41XTBEoLPFJE=\n-----END PRIVATE KEY-----\n"
  })
}, 'oldApp');

// 2. Initialize New App (Using environment variables we just set)
if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY) {
  throw new Error("Missing new Firebase credentials in .env");
}

const newApp = admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  })
}, 'newApp');

const oldDb = oldApp.firestore();
const newDb = newApp.firestore();

let totalDocsMigrated = 0;

async function copyDocument(oldDocRef: admin.firestore.DocumentReference, newDocRef: admin.firestore.DocumentReference) {
  const docSnap = await oldDocRef.get();
  if (docSnap.exists) {
    await newDocRef.set(docSnap.data()!);
    totalDocsMigrated++;
  }
  
  // Recursively copy all subcollections
  const subcollections = await oldDocRef.listCollections();
  for (const subcol of subcollections) {
    const subcolDocs = await subcol.get();
    for (const doc of subcolDocs.docs) {
      await copyDocument(doc.ref, newDocRef.collection(subcol.id).doc(doc.id));
    }
  }
}

async function migrateAuthUsers() {
  console.log("=== Migrating Firebase Auth Users ===");
  try {
    const listUsersResult = await oldApp.auth().listUsers(1000);
    if (listUsersResult.users.length === 0) {
      console.log("No users found to migrate.");
      return;
    }

    const usersToImport = listUsersResult.users.map(userRecord => ({
      uid: userRecord.uid,
      email: userRecord.email,
      emailVerified: userRecord.emailVerified,
      displayName: userRecord.displayName,
      photoURL: userRecord.photoURL,
      phoneNumber: userRecord.phoneNumber,
      disabled: userRecord.disabled,
      providerData: userRecord.providerData.map(p => ({
        uid: p.uid,
        email: p.email,
        displayName: p.displayName,
        photoURL: p.photoURL,
        providerId: p.providerId,
      })),
      customClaims: userRecord.customClaims,
    }));

    const importResult = await newApp.auth().importUsers(usersToImport);
    console.log(`Successfully imported ${importResult.successCount} users.`);
    if (importResult.failureCount > 0) {
      console.log(`Failed to import ${importResult.failureCount} users.`);
      importResult.errors.forEach(e => console.error("Auth Import Error:", e.error));
    }
  } catch (error) {
    console.error("Error migrating auth users:", error);
  }
}

async function migrateFirestore() {
  console.log("\n=== Migrating Firestore Database ===");
  try {
    // Get all root collections
    const rootCollections = await oldDb.listCollections();
    
    for (const collection of rootCollections) {
      console.log(`Copying root collection: [${collection.id}]...`);
      const snapshot = await collection.get();
      
      for (const doc of snapshot.docs) {
        await copyDocument(doc.ref, newDb.collection(collection.id).doc(doc.id));
      }
    }
    console.log(`\n✅ Firestore Migration Complete! Copied a total of ${totalDocsMigrated} documents across all collections and subcollections.`);
  } catch (error) {
    console.error("Error migrating Firestore:", error);
  }
}

async function run() {
  await migrateAuthUsers();
  await migrateFirestore();
  process.exit(0);
}

run();
