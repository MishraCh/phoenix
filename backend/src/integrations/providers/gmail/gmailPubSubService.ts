import { google } from "googleapis";
import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";

import { env } from "../../../config/env.js";
import { JobLockService } from "../../../jobs/jobLockService.js";
import { ApiError } from "../../../utils/apiError.js";
import { GmailSyncService } from "./gmailSyncService.js";

const pubSubEnvelopeSchema = z.object({
  message: z.object({
    data: z.string().min(1),
    messageId: z.string().optional(),
    publishTime: z.string().optional(),
  }),
  subscription: z.string().optional(),
});

const gmailPushPayloadSchema = z.object({
  emailAddress: z.string().email(),
  historyId: z.union([z.string(), z.number()]).transform((value) => String(value)),
});

export class GmailPubSubService {
  private readonly jobLockService: JobLockService;
  private readonly gmailSyncService: GmailSyncService;

  constructor(private readonly db: Firestore) {
    this.jobLockService = new JobLockService(db);
    this.gmailSyncService = new GmailSyncService(db);
  }

  private async verifyPushToken(authorizationHeader: string | undefined) {
    if (!env.GMAIL_PUBSUB_AUDIENCE) {
      return;
    }

    const match = authorizationHeader?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
      throw new ApiError({
        code: "UNAUTHORIZED",
        message: "Missing Pub/Sub bearer token.",
        status: 401,
      });
    }

    const oauth = new google.auth.OAuth2();
    let payload: { email?: string } | undefined;

    try {
      const ticket = await oauth.verifyIdToken({
        idToken: match[1],
        audience: env.GMAIL_PUBSUB_AUDIENCE,
      });
      payload = ticket.getPayload();
    } catch {
      throw new ApiError({
        code: "UNAUTHORIZED",
        message: "Pub/Sub push token verification failed.",
        status: 401,
      });
    }

    if (!payload) {
      throw new ApiError({
        code: "UNAUTHORIZED",
        message: "Pub/Sub push token payload was missing.",
        status: 401,
      });
    }

    if (
      env.GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL &&
      payload.email !== env.GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL
    ) {
      throw new ApiError({
        code: "UNAUTHORIZED",
        message: "Pub/Sub push service account did not match the configured Gmail webhook identity.",
        status: 401,
      });
    }
  }

  decodeEnvelope(body: unknown) {
    const envelope = pubSubEnvelopeSchema.parse(body);
    const decoded = Buffer.from(envelope.message.data, "base64").toString("utf8");
    const payload = gmailPushPayloadSchema.parse(JSON.parse(decoded));

    return {
      messageId: envelope.message.messageId ?? null,
      publishTime: envelope.message.publishTime ?? null,
      emailAddress: payload.emailAddress,
      historyId: payload.historyId,
    };
  }

  async enqueueDeltaJobs(body: unknown, authorizationHeader?: string) {
    await this.verifyPushToken(authorizationHeader);

    const decoded = this.decodeEnvelope(body);
    const connections = await this.gmailSyncService.findConnectionsByAccountEmail(decoded.emailAddress);

    if (connections.length === 0) {
      return {
        queued: 0,
        ignored: true,
        emailAddress: decoded.emailAddress,
        historyId: decoded.historyId,
      };
    }

    for (const connection of connections) {
      const connectionKey = `${connection.workspaceId}:${connection.id}`;
      await this.jobLockService.enqueueJob({
        workspaceId: connection.workspaceId,
        jobType: "gmail_delta_sync",
        runId: connection.id,
        userId: connection.ownedByUserId ?? connection.connectedBy,
        input: {
          provider: "gmail",
          connectionId: connection.id,
          historyId: decoded.historyId,
          emailAddress: decoded.emailAddress,
        },
        dedupeKey: `gmail_delta:${connectionKey}:${decoded.historyId}`,
      });
    }

    return {
      queued: connections.length,
      ignored: false,
      emailAddress: decoded.emailAddress,
      historyId: decoded.historyId,
    };
  }
}
