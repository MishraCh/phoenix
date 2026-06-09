import type { Request } from "express";
import { FieldValue, Timestamp, type DocumentReference, type Firestore } from "firebase-admin/firestore";

import { invalidateRequestStateCaches } from "../cache/requestStateCache.js";
import {
  workspaceMemberSchema,
  workspaceSchema,
  workspaceProfileSchema,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceProfile,
  type WorkspaceRole,
} from "../schemas/coreSchemas.js";
import { timeRequestPhase } from "../observability/requestTiming.js";
import { ApiError } from "../utils/apiError.js";

export type WorkspaceListItem = Workspace & { role: WorkspaceRole };

export function serializeWorkspaceListItem(workspace: WorkspaceListItem) {
  return {
    id: workspace.id,
    name: workspace.name,
    plan: workspace.plan,
    role: workspace.role,
    createdAt: workspace.createdAt.toDate().toISOString(),
  };
}

export class WorkspaceRepository {
  constructor(private readonly db: Firestore) {}

  async createWorkspace(name: string, ownerId: string): Promise<string> {
    const now = Timestamp.now();
    const workspaceRef = this.db.collection("workspaces").doc();
    const memberRef = workspaceRef.collection("members").doc(ownerId);

    await this.db.runTransaction(async (transaction) => {
      transaction.set(workspaceRef, {
        id: workspaceRef.id,
        name,
        ownerId,
        plan: "free",
        planSource: "system",
        monthlyCreditsLimit: 50, // Free plan default — keep in sync with authBootstrapService.ts
        monthlyCreditsUsed: 0,
        billingCycleStartAt: now,
        createdAt: now,
        updatedAt: now,
      });

      transaction.set(memberRef, {
        userId: ownerId,
        workspaceId: workspaceRef.id,
        role: "owner",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      transaction.set(
        this.db.collection("users").doc(ownerId),
        {
          defaultWorkspaceId: workspaceRef.id,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    invalidateRequestStateCaches(ownerId);

    return workspaceRef.id;
  }

  async getWorkspace(workspaceId: string): Promise<Workspace | null> {
    const snapshot = await this.db.collection("workspaces").doc(workspaceId).get();

    if (!snapshot.exists) {
      return null;
    }

    return workspaceSchema.parse({ id: snapshot.id, ...snapshot.data() });
  }

  async getMember(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    const snapshot = await this.db
      .collection("workspaces")
      .doc(workspaceId)
      .collection("members")
      .doc(userId)
      .get();

    if (!snapshot.exists) {
      return null;
    }

    return workspaceMemberSchema.parse(snapshot.data());
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const snapshot = await this.db
      .collection("workspaces")
      .doc(workspaceId)
      .collection("members")
      .orderBy("createdAt", "asc")
      .get();

    return snapshot.docs.map((doc) => workspaceMemberSchema.parse(doc.data()));
  }

  async listWorkspacesForUser(
    userId: string,
    request?: Request,
  ): Promise<WorkspaceListItem[]> {
    const memberSnapshot = await timeRequestPhase(request, "workspaces.members_query", async () =>
      this.db
        .collectionGroup("members")
        .where("userId", "==", userId)
        .where("status", "==", "active")
        .get(),
    );

    const memberDocs = memberSnapshot.docs.map((memberDoc) => {
      const workspaceRef = memberDoc.ref.parent.parent;

      if (!workspaceRef) {
        throw new ApiError({
          code: "INTERNAL_ERROR",
          message: "Workspace member document is missing its parent workspace.",
          status: 500,
        });
      }

      return {
        member: workspaceMemberSchema.parse(memberDoc.data()),
        workspaceRef,
      };
    });

    const workspaceRefs = memberDocs.map((doc) => doc.workspaceRef as DocumentReference);
    const workspaceSnapshots = workspaceRefs.length
      ? await timeRequestPhase(request, "workspaces.batch_get", async () =>
          this.db.getAll(...workspaceRefs),
        )
      : [];

    return workspaceSnapshots
      .map((workspaceSnapshot, index) => {
        if (!workspaceSnapshot.exists) {
          return null;
        }

        return {
          ...workspaceSchema.parse({ id: workspaceSnapshot.id, ...workspaceSnapshot.data() }),
          role: memberDocs[index]?.member.role,
        };
      })
      .filter((workspace): workspace is WorkspaceListItem => Boolean(workspace));
  }

  async updateSettings(
    workspaceId: string,
    updates: { 
      defaultContextBundleId?: string | null; 
      profile?: WorkspaceProfile | null;
      channelsConfig?: { emailEnabled: boolean; whatsappEnabled: boolean; };
    },
  ): Promise<void> {
    const ref = this.db.collection("workspaces").doc(workspaceId);
    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (updates.defaultContextBundleId !== undefined) {
      patch.defaultContextBundleId = updates.defaultContextBundleId ?? FieldValue.delete();
    }
    if (updates.profile !== undefined) {
      if (updates.profile === null) {
        patch.profile = FieldValue.delete();
      } else {
        // Validate before writing
        const parsed = workspaceProfileSchema.parse(updates.profile);
        // Strip undefined fields — Firestore merge won't delete them but
        // we want the stored object to stay clean.
        patch.profile = Object.fromEntries(
          Object.entries(parsed).filter(([, v]) => v !== undefined),
        );
      }
    }
    if (updates.channelsConfig !== undefined) {
      patch.channelsConfig = updates.channelsConfig;
    }
    await ref.update(patch);
  }

  async setDefaultWorkspaceForActiveMember(
    userId: string,
    workspaceId: string,
  ): Promise<{ workspaceId: string; defaultWorkspaceId: string }> {
    const userRef = this.db.collection("users").doc(userId);
    const workspaceRef = this.db.collection("workspaces").doc(workspaceId);
    const memberRef = workspaceRef.collection("members").doc(userId);

    const result = await this.db.runTransaction(async (transaction) => {
      const [userSnapshot, workspaceSnapshot, memberSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(workspaceRef),
        transaction.get(memberRef),
      ]);

      if (!workspaceSnapshot.exists) {
        throw new ApiError({
          code: "NOT_FOUND",
          message: "Workspace not found.",
          status: 404,
        });
      }

      if (!memberSnapshot.exists) {
        throw new ApiError({
          code: "FORBIDDEN",
          message: "You are not an active member of this workspace.",
          status: 403,
        });
      }

      const member = workspaceMemberSchema.parse(memberSnapshot.data());

      if (member.status !== "active") {
        throw new ApiError({
          code: "FORBIDDEN",
          message: "You are not an active member of this workspace.",
          status: 403,
        });
      }

      if (userSnapshot.get("defaultWorkspaceId") !== workspaceId) {
        transaction.set(
          userRef,
          {
            defaultWorkspaceId: workspaceId,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      return {
        workspaceId,
        defaultWorkspaceId: workspaceId,
      };
    });

    invalidateRequestStateCaches(userId);

    return result;
  }
}
