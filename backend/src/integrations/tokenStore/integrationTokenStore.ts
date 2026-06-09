import { Timestamp, type Firestore } from "firebase-admin/firestore";

import type { IntegrationConnection, IntegrationTokenPayload } from "../core/integrationContracts.js";
import { decryptJson, encryptJson } from "../integrationCrypto.js";

export class IntegrationTokenStore {
  constructor(private readonly db: Firestore) {}

  private integrationDoc(workspaceId: string, provider: string) {
    return this.db.collection("workspaces").doc(workspaceId).collection("integrations").doc(provider);
  }

  async read(connection: Pick<IntegrationConnection, "workspaceId" | "provider">) {
    const snapshot = await this.integrationDoc(connection.workspaceId, connection.provider).get();
    const encryptedToken = snapshot.data()?.["encryptedToken"];

    if (typeof encryptedToken !== "string" || !encryptedToken.trim()) {
      return null;
    }

    return decryptJson<IntegrationTokenPayload>(encryptedToken);
  }

  async write(
    connection: Pick<IntegrationConnection, "workspaceId" | "provider">,
    tokenPayload: IntegrationTokenPayload,
  ) {
    const tokenExpiresAt =
      typeof tokenPayload.expiryDate === "number"
        ? Timestamp.fromMillis(tokenPayload.expiryDate)
        : null;

    await this.integrationDoc(connection.workspaceId, connection.provider).set(
      {
        encryptedToken: encryptJson(tokenPayload),
        tokenExpiresAt,
        lastSuccessfulRefreshAt: Timestamp.now(),
        refreshFailureAt: null,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  }

  async markRefreshFailure(
    connection: Pick<IntegrationConnection, "workspaceId" | "provider">,
    errorCode: string,
  ) {
    await this.integrationDoc(connection.workspaceId, connection.provider).set(
      {
        refreshFailureAt: Timestamp.now(),
        lastErrorCode: errorCode,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  }

  async clear(connection: Pick<IntegrationConnection, "workspaceId" | "provider">) {
    await this.integrationDoc(connection.workspaceId, connection.provider).set(
      {
        encryptedToken: null,
        tokenExpiresAt: null,
        refreshFailureAt: null,
        lastSuccessfulRefreshAt: null,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  }
}
