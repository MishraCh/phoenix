import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

import { userSchema, type User } from "../schemas/coreSchemas.js";

type SyncUserInput = {
  id: string;
  email: string;
  displayName?: string;
  photoURL?: string;
};

export class UserRepository {
  constructor(private readonly db: Firestore) {}

  async getUser(userId: string): Promise<User | null> {
    const snapshot = await this.db.collection("users").doc(userId).get();

    if (!snapshot.exists) {
      return null;
    }

    return userSchema.parse({ id: snapshot.id, ...snapshot.data() });
  }

  async syncFromAuth(input: SyncUserInput, existingUser?: User | null): Promise<User> {
    const now = Timestamp.now();
    const userRef = this.db.collection("users").doc(input.id);
    const currentUser = existingUser ?? (await this.getUser(input.id));
    const createdAt = currentUser?.createdAt ?? now;
    const nextUser = userSchema.parse({
      id: input.id,
      email: input.email,
      displayName: input.displayName,
      photoURL: input.photoURL,
      defaultWorkspaceId: currentUser?.defaultWorkspaceId,
      createdAt,
      updatedAt: now,
    });

    const needsWrite =
      !currentUser
      || currentUser.email !== input.email
      || (currentUser.displayName ?? undefined) !== input.displayName
      || (currentUser.photoURL ?? undefined) !== input.photoURL;

    if (!needsWrite) {
      return currentUser;
    }

    await userRef.set(
      {
        email: input.email,
        displayName: input.displayName ?? null,
        photoURL: input.photoURL ?? null,
        updatedAt: FieldValue.serverTimestamp(),
        ...(currentUser ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );

    return nextUser;
  }

  async setDefaultWorkspaceId(userId: string, workspaceId: string): Promise<void> {
    await this.db.collection("users").doc(userId).set(
      {
        defaultWorkspaceId: workspaceId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
}
