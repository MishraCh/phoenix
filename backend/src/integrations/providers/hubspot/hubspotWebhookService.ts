import crypto from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";

import { env } from "../../../config/env.js";
import { JobLockService } from "../../../jobs/jobLockService.js";
import { ApiError } from "../../../utils/apiError.js";

const hubspotEventSchema = z.array(z.object({
  eventId: z.number().optional(),
  subscriptionId: z.number().optional(),
  portalId: z.number(),
  appId: z.number().optional(),
  occurredAt: z.number().optional(),
  subscriptionType: z.string().optional(),
  attemptNumber: z.number().optional(),
  objectId: z.number().optional(),
  propertyName: z.string().optional(),
  propertyValue: z.string().optional(),
  changeSource: z.string().optional(),
}));

export class HubspotWebhookService {
  private readonly jobLockService: JobLockService;

  constructor(private readonly db: Firestore) {
    this.jobLockService = new JobLockService(db);
  }

  verifySignature(input: {
    signature?: string;
    bodyString: string;
    timestamp?: string;
    method?: string;
    requestUrl?: string;
  }) {
    if (!env.HUBSPOT_CLIENT_SECRET) {
      return; // Skip if no secret is configured
    }

    if (!input.signature) {
      throw new ApiError({
        code: "UNAUTHORIZED",
        message: "Missing HubSpot signature.",
        status: 401,
      });
    }

    if (!input.timestamp || !input.method || !input.requestUrl) {
      throw new ApiError({
        code: "UNAUTHORIZED",
        message: "HubSpot webhook verification context is incomplete.",
        status: 401,
      });
    }

    const parsedTimestamp = Number(input.timestamp);
    const timestampMs = parsedTimestamp > 1_000_000_000_000 ? parsedTimestamp : parsedTimestamp * 1000;
    const requestAgeMs = Math.abs(Date.now() - timestampMs);
    if (!Number.isFinite(requestAgeMs) || requestAgeMs > 5 * 60 * 1000) {
      throw new ApiError({
        code: "UNAUTHORIZED",
        message: "HubSpot webhook timestamp is outside the allowed window.",
        status: 401,
      });
    }

    const source = `${input.method.toUpperCase()}${input.requestUrl}${input.bodyString}${input.timestamp}`;
    const expected = crypto
      .createHmac("sha256", env.HUBSPOT_CLIENT_SECRET)
      .update(source)
      .digest("base64");

    const actualBuffer = Buffer.from(input.signature);
    const expectedBuffer = Buffer.from(expected);
    const matches =
      actualBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(actualBuffer, expectedBuffer);

    if (!matches) {
      throw new ApiError({
        code: "UNAUTHORIZED",
        message: "HubSpot webhook signature verification failed.",
        status: 401,
      });
    }
  }

  async enqueueDeltaJobs(
    body: unknown,
    requestContext?: {
      signature?: string;
      rawBody?: string;
      timestamp?: string;
      method?: string;
      requestUrl?: string;
    },
  ) {
    if (requestContext?.rawBody) {
      this.verifySignature({
        signature: requestContext.signature,
        bodyString: requestContext.rawBody,
        timestamp: requestContext.timestamp,
        method: requestContext.method,
        requestUrl: requestContext.requestUrl,
      });
    }

    const events = hubspotEventSchema.parse(body);
    
    if (events.length === 0) {
      return { queued: 0, ignored: true };
    }

    const portalIds = Array.from(new Set(events.map((event) => event.portalId).filter((value) => Number.isFinite(value))));
    const integrationsSnapshot = await this.db
      .collectionGroup("integrations")
      .where("provider", "==", "hubspot")
      .where("status", "==", "connected")
      .get();

    const candidateDocs = integrationsSnapshot.docs.filter((doc) =>
      portalIds.includes(Number(doc.data().portalId)),
    );

    if (!candidateDocs.length) {
      return { queued: 0, ignored: true };
    }

    let queued = 0;
    
    for (const doc of candidateDocs) {
      const integration = doc.data();
      const workspaceId = doc.ref.parent.parent?.id;
      
      if (!workspaceId) continue;
      
      const connectionKey = `${workspaceId}:${doc.id}`;
      
      await this.jobLockService.enqueueJob({
        workspaceId,
        jobType: "hubspot_delta_sync",
        runId: doc.id,
        userId: integration.ownedByUserId ?? integration.connectedBy,
        input: {
          provider: "hubspot",
          connectionId: doc.id,
          events,
        },
        dedupeKey: `hubspot_delta:${connectionKey}:${Date.now()}`,
      });
      queued++;
    }

    return {
      queued,
      ignored: false,
    };
  }
}
