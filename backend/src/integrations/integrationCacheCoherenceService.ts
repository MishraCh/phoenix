import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { sessionStateSnapshotSchema } from "../ai/contracts/sessionState.js";
import { logger } from "../observability/logger.js";

export class IntegrationCacheCoherenceService {
  constructor(private readonly db: Firestore) {}

  async invalidateProvider(workspaceId: string, provider: "gmail" | "hubspot", reason: string) {
    const workspaceRef = this.db.collection("workspaces").doc(workspaceId);
    const [bundles, sessions] = await Promise.all([
      workspaceRef.collection("contextBundles").limit(200).get(),
      workspaceRef.collection("commandSessions").limit(200).get(),
    ]);
    const now = Timestamp.now();
    const batch = this.db.batch();

    for (const doc of bundles.docs) {
      const data = doc.data();
      const referencesProvider =
        JSON.stringify(data["sourceRefs"] ?? []).toLowerCase().includes(provider) ||
        JSON.stringify(data["content"] ?? {}).toLowerCase().includes(provider);
      if (referencesProvider) {
        batch.update(doc.ref, {
          freshness: "stale",
          invalidationReason: reason,
          expiresAt: now,
          updatedAt: now,
        });
      }
    }

    for (const doc of sessions.docs) {
      const raw = doc.data()["sessionStateJson"];
      if (typeof raw !== "string") continue;
      try {
        const state = sessionStateSnapshotSchema.parse(JSON.parse(raw));
        const next = {
          ...state,
          revision: state.revision + 1,
          activeEntities: state.activeEntities.filter((entity) => entity.provider !== provider),
          selectedRefs: state.selectedRefs.filter((ref) => ref.provider !== provider),
          pendingDisambiguation:
            state.pendingDisambiguation?.candidates.some((candidate) => candidate.provider === provider)
              ? undefined
              : state.pendingDisambiguation,
          pendingAction:
            state.pendingAction?.provider === provider ? undefined : state.pendingAction,
          updatedAt: new Date().toISOString(),
        };
        batch.update(doc.ref, {
          sessionStateJson: JSON.stringify(next),
          sessionStateRevision: next.revision,
          updatedAt: now,
        });
      } catch {
        logger.debug("Skipped malformed session state during provider invalidation", {
          workspaceId,
          sessionId: doc.id,
          provider,
        });
      }
    }

    await batch.commit();
    return { bundlesChecked: bundles.size, sessionsChecked: sessions.size };
  }
}
