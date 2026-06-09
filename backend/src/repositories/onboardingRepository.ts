import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

import { onboardingStateSchema, type OnboardingState } from "../schemas/coreSchemas.js";

export type SaveOnboardingStateInput = {
  workspaceId: string;
  userId: string;
  currentStep: number;
  completed: boolean;
  sampleWorkspaceEnabled: boolean;
  responses: Record<string, unknown>;
};

export class OnboardingRepository {
  constructor(private readonly db: Firestore) {}

  private stateRef(workspaceId: string, userId: string) {
    return this.db
      .collection("workspaces")
      .doc(workspaceId)
      .collection("context")
      .doc(`onboarding_${userId}`);
  }

  async getState(workspaceId: string, userId: string): Promise<OnboardingState | null> {
    const snapshot = await this.stateRef(workspaceId, userId).get();

    if (!snapshot.exists) {
      return null;
    }

    return onboardingStateSchema.parse(snapshot.data());
  }

  async saveState(input: SaveOnboardingStateInput): Promise<OnboardingState> {
    const ref = this.stateRef(input.workspaceId, input.userId);
    const existing = await ref.get();
    const now = Timestamp.now();

    await ref.set(
      {
        workspaceId: input.workspaceId,
        userId: input.userId,
        currentStep: input.currentStep,
        completed: input.completed,
        sampleWorkspaceEnabled: input.sampleWorkspaceEnabled,
        responses: input.responses,
        createdAt: existing.exists ? existing.get("createdAt") : now,
        updatedAt: now,
        ...(input.completed ? { completedAt: now } : {}),
        updatedAtServer: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const snapshot = await ref.get();
    return onboardingStateSchema.parse(snapshot.data());
  }
}
