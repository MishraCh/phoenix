import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

import type { AuthenticatedUser } from "./types.js";
import { invalidateRequestStateCaches } from "../cache/requestStateCache.js";
import { OnboardingRepository } from "../repositories/onboardingRepository.js";
import {
  serializeWorkspaceListItem,
  WorkspaceRepository,
} from "../repositories/workspaceRepository.js";
import { ApiError } from "../utils/apiError.js";

type BootstrapOnboarding = {
  workspaceId: string;
  userId: string;
  currentStep: number;
  completed: boolean;
  sampleWorkspaceEnabled: boolean;
  responses: Record<string, unknown>;
  updatedAt: string | null;
  completedAt: string | null;
};

export type AuthBootstrapResult = {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    photoURL: string | null;
    defaultWorkspaceId: string | null;
  };
  defaultWorkspace: ReturnType<typeof serializeWorkspaceListItem>;
  workspaces: Array<ReturnType<typeof serializeWorkspaceListItem>>;
  onboarding: BootstrapOnboarding;
};

function toDisplayToken(value?: string | null) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return null;
  }

  const firstToken = trimmedValue.split(/\s+/)[0]?.trim();

  return firstToken || null;
}

function humanizeEmailLocalPart(email?: string | null) {
  const localPart = email?.split("@")[0]?.trim();

  if (!localPart) {
    return null;
  }

  const normalized = localPart.replace(/[._-]+/g, " ").trim();
  const firstToken = normalized.split(/\s+/)[0]?.trim();

  if (!firstToken) {
    return null;
  }

  return firstToken.charAt(0).toUpperCase() + firstToken.slice(1);
}

export function buildDefaultWorkspaceName(displayName?: string | null, email?: string | null) {
  const preferredName = toDisplayToken(displayName) ?? humanizeEmailLocalPart(email);

  if (!preferredName) {
    return "My Workspace";
  }

  return `${preferredName}'s Workspace`;
}

function serializeBootstrapUser(user: AuthenticatedUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    defaultWorkspaceId: user.defaultWorkspaceId ?? null,
  };
}

function serializeOnboardingState(
  workspaceId: string,
  userId: string,
  onboarding?: {
    currentStep: number;
    completed: boolean;
    sampleWorkspaceEnabled: boolean;
    responses: Record<string, unknown>;
    updatedAt?: Timestamp;
    completedAt?: Timestamp;
  } | null,
): BootstrapOnboarding {
  if (!onboarding) {
    return {
      workspaceId,
      userId,
      currentStep: 0,
      completed: false,
      sampleWorkspaceEnabled: true,
      responses: {},
      updatedAt: null,
      completedAt: null,
    };
  }

  return {
    workspaceId,
    userId,
    currentStep: onboarding.currentStep,
    completed: onboarding.completed,
    sampleWorkspaceEnabled: onboarding.sampleWorkspaceEnabled,
    responses: onboarding.responses,
    updatedAt: onboarding.updatedAt?.toDate().toISOString() ?? null,
    completedAt: onboarding.completedAt?.toDate().toISOString() ?? null,
  };
}

export class AuthBootstrapService {
  constructor(private readonly db: Firestore) {}

  async bootstrap(user: AuthenticatedUser): Promise<AuthBootstrapResult> {
    const userRef = this.db.collection("users").doc(user.id);
    const { defaultWorkspaceId, mutated } = await this.db.runTransaction(async (transaction) => {
      const userSnapshot = await transaction.get(userRef);
      const storedDefaultWorkspaceId = userSnapshot.get("defaultWorkspaceId") as string | undefined;

      if (storedDefaultWorkspaceId) {
        const workspaceRef = this.db.collection("workspaces").doc(storedDefaultWorkspaceId);
        const memberRef = workspaceRef.collection("members").doc(user.id);
        const [workspaceSnapshot, memberSnapshot] = await Promise.all([
          transaction.get(workspaceRef),
          transaction.get(memberRef),
        ]);

        if (workspaceSnapshot.exists && memberSnapshot.exists && memberSnapshot.get("status") === "active") {
          return { defaultWorkspaceId: storedDefaultWorkspaceId, mutated: false };
        }
      }

      const membershipsSnapshot = await transaction.get(
        this.db
          .collectionGroup("members")
          .where("userId", "==", user.id)
          .where("status", "==", "active")
          .limit(1),
      );

      const firstMembershipWorkspaceRef = membershipsSnapshot.docs[0]?.ref.parent.parent;

      if (firstMembershipWorkspaceRef) {
        transaction.set(
          userRef,
          {
            defaultWorkspaceId: firstMembershipWorkspaceRef.id,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        return { defaultWorkspaceId: firstMembershipWorkspaceRef.id, mutated: true };
      }

      const now = Timestamp.now();
      const workspaceRef = this.db.collection("workspaces").doc();
      const memberRef = workspaceRef.collection("members").doc(user.id);
      const workspaceName = buildDefaultWorkspaceName(user.displayName, user.email);

      transaction.set(workspaceRef, {
        id: workspaceRef.id,
        name: workspaceName,
        ownerId: user.id,
        plan: "free",
        planSource: "system",
        monthlyCreditsLimit: 50, // Free plan default — keep in sync with workspaceRepository.ts
        monthlyCreditsUsed: 0,
        billingCycleStartAt: now,
        createdAt: now,
        updatedAt: now,
      });

      transaction.set(memberRef, {
        userId: user.id,
        workspaceId: workspaceRef.id,
        role: "owner",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      transaction.set(
        userRef,
        {
          defaultWorkspaceId: workspaceRef.id,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return { defaultWorkspaceId: workspaceRef.id, mutated: true };
    });

    if (mutated) {
      invalidateRequestStateCaches(user.id);
    }

    const workspaceRepository = new WorkspaceRepository(this.db);
    const workspaces = await workspaceRepository.listWorkspacesForUser(user.id);
    let defaultWorkspace =
      workspaces.find((workspace) => workspace.id === defaultWorkspaceId) ??
      workspaces[0];

    // Workaround for Firestore collectionGroup index propagation delay:
    // If the transaction just created a workspace, the collectionGroup query might
    // temporarily miss the new member document. We can fetch it directly to ensure
    // the user can proceed without getting locked out.
    if (!defaultWorkspace && defaultWorkspaceId) {
      const directWorkspace = await workspaceRepository.getWorkspace(defaultWorkspaceId);
      const directMember = await workspaceRepository.getMember(defaultWorkspaceId, user.id);
      
      if (directWorkspace && directMember && directMember.status === "active") {
        defaultWorkspace = { ...directWorkspace, role: directMember.role };
        workspaces.push(defaultWorkspace);
      }
    }

    if (!defaultWorkspace) {
      throw new ApiError({
        code: "WORKSPACE_REQUIRED",
        message: "A workspace is required before continuing.",
        status: 400,
      });
    }

    const onboardingRepository = new OnboardingRepository(this.db);
    const onboarding = await onboardingRepository.getState(defaultWorkspace.id, user.id);

    return {
      user: {
        ...serializeBootstrapUser({
          ...user,
          defaultWorkspaceId: defaultWorkspace.id,
        }),
        defaultWorkspaceId: defaultWorkspace.id,
      },
      defaultWorkspace: serializeWorkspaceListItem(defaultWorkspace),
      workspaces: workspaces.map(serializeWorkspaceListItem),
      onboarding: serializeOnboardingState(defaultWorkspace.id, user.id, onboarding),
    };
  }
}
