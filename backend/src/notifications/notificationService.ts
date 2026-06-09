import type { Request } from "express";
import { FieldValue, Timestamp, type Firestore, type Query } from "firebase-admin/firestore";

import { publishEvent } from "../sse/eventBus.js";

import { timeRequestPhase } from "../observability/requestTiming.js";
import { notificationSchema, type Workspace } from "../schemas/coreSchemas.js";
import { ApiError } from "../utils/apiError.js";
import { SmtpService } from "../services/smtpService.js";
import { getAuth } from "firebase-admin/auth";

export type CreateNotificationInput = {
  workspaceId: string;
  userId?: string;
  type: "approval_needed" | "workflow_completed" | "workflow_failed" | "report_ready" | "integration_error" | "missing_context" | "agent_needs_setup";
  title: string;
  body?: string;
  actionUrl?: string;
  related?: Record<string, string>;
};

function serializeNotification(notification: ReturnType<typeof notificationSchema.parse>) {
  return {
    id: notification.id,
    title: notification.title,
    body: notification.body ?? null,
    read: notification.status === "read",
    createdAt: notification.createdAt.toDate().toISOString(),
    actionUrl: notification.actionUrl ?? null,
  };
}

export class NotificationService {
  constructor(private readonly db: Firestore) {}

  async createNotification(input: CreateNotificationInput) {
    const notificationRef = this.db
      .collection("workspaces")
      .doc(input.workspaceId)
      .collection("notifications")
      .doc();

    const derivedActionUrl =
      input.actionUrl ??
      (input.related?.approvalId ? `/approvals/${input.related.approvalId}` :
       input.related?.artifactId ? `/library/${input.related.artifactId}` :
       input.related?.workflowId ? `/workflows` :
       input.type === "integration_error" ? "/integrations" :
       input.type === "missing_context" ? "/context" :
       input.type === "agent_needs_setup" ? "/agents" :
       undefined);

    const notification = {
      id: notificationRef.id,
      workspaceId: input.workspaceId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      status: "unread" as const,
      actionUrl: derivedActionUrl,
      related: input.related,
      createdAt: Timestamp.now(),
    };

    notificationSchema.parse(notification);
    await notificationRef.set(notification);
    publishEvent([`workspace:${input.workspaceId}`], "notification.created", {
      workspaceId: input.workspaceId, notificationId: notification.id, title: input.title, type: input.type, timestamp: new Date().toISOString(),
    });

      // Fire email notifications if user exists
    if (input.userId) {
      try {
        const userRecord = await getAuth().getUser(input.userId);
        if (userRecord.email) {
          if (input.type === "approval_needed" && input.title.includes("High-value signal")) {
            await SmtpService.sendWorkflowActionRequired(userRecord.email, input.title, input.body || "", derivedActionUrl || "");
          } else if (input.type === "workflow_completed" && input.title.includes("Commitment")) {
            await SmtpService.sendCommitmentReminder(userRecord.email, input.title, input.body || "", derivedActionUrl || "");
          } else if (input.type === "report_ready" && input.title.includes("Morning Brief")) {
            await SmtpService.sendDailyBrief(userRecord.email, input.title, input.body || "", derivedActionUrl || "");
          }
          // Note: workflow_completed + channel=email is handled directly in workflowRunProcessor
          // to avoid sending duplicate emails. Do NOT add that case back here.
        }
      } catch (err) {
        // Ignore auth error for missing user or unverified email in this flow
      }
    }

    return notification;
  }

  async listNotifications(
    workspace: Workspace,
    userId: string,
    options: { limit?: number; read?: boolean },
    request?: Request,
  ) {
    const limit = options.limit ?? 25;
    let query: Query = this.db
      .collection("workspaces")
      .doc(workspace.id)
      .collection("notifications")
      .where("userId", "==", userId);

    if (typeof options.read === "boolean") {
      query = query.where("status", "==", options.read ? "read" : "unread");
    }

    query = query.orderBy("createdAt", "desc").limit(limit);

    const snapshot = await timeRequestPhase(request, "notifications.query", async () => query.get());

    return snapshot.docs
      .map((doc) => notificationSchema.parse({ id: doc.id, ...doc.data() }))
      .map(serializeNotification);
  }

  async markRead(workspace: Workspace, notificationId: string, userId: string) {
    const notificationRef = this.db
      .collection("workspaces")
      .doc(workspace.id)
      .collection("notifications")
      .doc(notificationId);
    const snapshot = await notificationRef.get();

    if (!snapshot.exists) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Notification not found.",
        status: 404,
      });
    }

    const notification = notificationSchema.parse({ id: snapshot.id, ...snapshot.data() });

    if (notification.userId && notification.userId !== userId) {
      throw new ApiError({
        code: "FORBIDDEN",
        message: "You cannot mark another user's notification as read.",
        status: 403,
      });
    }

    await notificationRef.update({
      status: "read",
      readAt: Timestamp.now(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      notificationId,
      read: true,
    };
  }

  async markAllRead(workspace: Workspace, userId: string) {
    const snapshot = await this.db
      .collection("workspaces")
      .doc(workspace.id)
      .collection("notifications")
      .where("userId", "==", userId)
      .where("status", "==", "unread")
      .get();

    if (snapshot.empty) return { count: 0 };

    const batch = this.db.batch();
    const now = Timestamp.now();
    for (const doc of snapshot.docs) {
      batch.update(doc.ref, { status: "read", readAt: now, updatedAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();
    return { count: snapshot.size };
  }

  async deleteNotification(workspace: Workspace, notificationId: string, userId: string) {
    const notificationRef = this.db
      .collection("workspaces")
      .doc(workspace.id)
      .collection("notifications")
      .doc(notificationId);
    const snapshot = await notificationRef.get();

    if (!snapshot.exists) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Notification not found.",
        status: 404,
      });
    }

    const notification = notificationSchema.parse({ id: snapshot.id, ...snapshot.data() });

    if (notification.userId && notification.userId !== userId) {
      throw new ApiError({
        code: "FORBIDDEN",
        message: "You cannot delete another user's notification.",
        status: 403,
      });
    }

    await notificationRef.delete();
    return { notificationId, deleted: true };
  }

  async deleteAllNotifications(workspace: Workspace, userId: string) {
    const snapshot = await this.db
      .collection("workspaces")
      .doc(workspace.id)
      .collection("notifications")
      .where("userId", "==", userId)
      .get();

    if (snapshot.empty) return { count: 0 };

    const batch = this.db.batch();
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    return { count: snapshot.size };
  }
}
