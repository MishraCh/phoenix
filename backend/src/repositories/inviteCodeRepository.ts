import { randomBytes } from "node:crypto";

import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

import type { AuthenticatedUser } from "../auth/types.js";
import { invalidateRequestStateCaches } from "../cache/requestStateCache.js";
import {
  inviteCodeSchema,
  workspaceMemberSchema,
  type InviteCode,
  type WorkspaceRole,
} from "../schemas/coreSchemas.js";
import { ApiError } from "../utils/apiError.js";

type CreateInviteCodeInput = {
  workspaceId: string;
  roleGranted: Exclude<WorkspaceRole, "owner">;
  maxUses: number;
  emailRestriction?: string | null;
  expiresAt?: Date | null;
  createdBy: string;
};

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

function createReadableCode() {
  return `GDN-${randomBytes(3).toString("hex").toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export class InviteCodeRepository {
  constructor(private readonly db: Firestore) {}

  private collection(workspaceId: string) {
    return this.db.collection("workspaces").doc(workspaceId).collection("inviteCodes");
  }

  async createInviteCode(input: CreateInviteCodeInput): Promise<InviteCode> {
    const inviteRef = this.collection(input.workspaceId).doc();
    const now = Timestamp.now();
    const invite = inviteCodeSchema.parse({
      id: inviteRef.id,
      code: createReadableCode(),
      workspaceId: input.workspaceId,
      roleGranted: input.roleGranted,
      emailRestriction: input.emailRestriction ? input.emailRestriction.toLowerCase() : undefined,
      maxUses: input.maxUses,
      useCount: 0,
      status: "active",
      createdBy: input.createdBy,
      expiresAt: input.expiresAt ? Timestamp.fromDate(input.expiresAt) : undefined,
      createdAt: now,
      updatedAt: now,
    });

    await inviteRef.set(invite);
    return invite;
  }

  async redeemInviteCode(input: { workspaceId: string; inviteCode: string; user: AuthenticatedUser }) {
    const normalizedCode = normalizeCode(input.inviteCode);
    const workspaceRef = this.db.collection("workspaces").doc(input.workspaceId);
    const inviteQuery = workspaceRef
      .collection("inviteCodes")
      .where("code", "==", normalizedCode)
      .limit(1);
    const memberRef = workspaceRef.collection("members").doc(input.user.id);
    const userRef = this.db.collection("users").doc(input.user.id);

    const result = await this.db.runTransaction(async (transaction) => {
      const [workspaceSnapshot, inviteSnapshot, existingMemberSnapshot] = await Promise.all([
        transaction.get(workspaceRef),
        transaction.get(inviteQuery),
        transaction.get(memberRef),
      ]);

      if (!workspaceSnapshot.exists) {
        throw new ApiError({
          code: "NOT_FOUND",
          message: "Workspace not found.",
          status: 404,
        });
      }

      if (existingMemberSnapshot.exists) {
        throw new ApiError({
          code: "ALREADY_MEMBER",
          message: "You are already a member of this workspace.",
          status: 409,
        });
      }

      const inviteDoc = inviteSnapshot.docs[0];

      if (!inviteDoc) {
        throw new ApiError({
          code: "INVITE_CODE_INVALID",
          message: "Invite code is invalid, revoked, or expired.",
          status: 400,
        });
      }

      const invite = inviteCodeSchema.parse({ id: inviteDoc.id, ...inviteDoc.data() });
      const now = Timestamp.now();

      if (
        invite.status !== "active" ||
        (invite.expiresAt && invite.expiresAt.toMillis() <= now.toMillis())
      ) {
        throw new ApiError({
          code: "INVITE_CODE_INVALID",
          message: "Invite code is invalid, revoked, or expired.",
          status: 400,
        });
      }

      if (invite.useCount >= invite.maxUses) {
        throw new ApiError({
          code: "INVITE_CODE_EXHAUSTED",
          message: "Invite code has already been fully used.",
          status: 400,
        });
      }

      if (invite.emailRestriction && invite.emailRestriction !== input.user.email.toLowerCase()) {
        throw new ApiError({
          code: "INVITE_CODE_INVALID",
          message: "Invite code is not valid for this email address.",
          status: 400,
        });
      }

      const member = workspaceMemberSchema.parse({
        userId: input.user.id,
        workspaceId: input.workspaceId,
        role: invite.roleGranted,
        status: "active",
        invitedBy: invite.createdBy,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      transaction.set(memberRef, member);
      transaction.update(inviteDoc.ref, {
        useCount: FieldValue.increment(1),
        updatedAt: now,
      });
      transaction.set(
        userRef,
        {
          defaultWorkspaceId: input.workspaceId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return {
        workspaceId: input.workspaceId,
        role: invite.roleGranted,
        defaultWorkspaceId: input.workspaceId,
      };
    });

    invalidateRequestStateCaches(input.user.id);

    return result;
  }
}
