import type { Request, Response } from "express";

import { requireUser } from "../auth/authMiddleware.js";
import { env } from "../config/env.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { IntegrationService } from "../integrations/integrationService.js";
import { IntegrationWorkspaceService } from "../integrations/integrationWorkspaceService.js";
import { GmailPubSubService } from "../integrations/providers/gmail/gmailPubSubService.js";
import { GmailSyncService } from "../integrations/providers/gmail/gmailSyncService.js";
import { HubspotWebhookService } from "../integrations/providers/hubspot/hubspotWebhookService.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";
import { ApiError } from "../utils/apiError.js";

function getProvider(request: Request) {
  return Array.isArray(request.params.provider) ? request.params.provider[0] : request.params.provider;
}

function getAction(request: Request) {
  return Array.isArray(request.params.action) ? request.params.action[0] : request.params.action;
}

function getItemId(request: Request) {
  return Array.isArray(request.params.itemId) ? request.params.itemId[0] : request.params.itemId;
}

function serializeGmailStyleProfile(
  profile:
    | {
        id: string;
        workspaceId: string;
        userId: string;
        sampleSize: number;
        tone: string;
        formality: string;
        greetingStyle: string;
        signOffStyle: string;
        sentenceLength: string;
        commonPhrasing: string[];
        doPreferences: string[];
        dontPreferences: string[];
        summary: string;
        createdAt: { toDate(): Date };
        updatedAt: { toDate(): Date };
      }
    | null,
) {
  if (!profile) {
    return null;
  }

  return {
    ...profile,
    createdAt: profile.createdAt.toDate().toISOString(),
    updatedAt: profile.updatedAt.toDate().toISOString(),
  };
}

export async function listIntegrations(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new IntegrationService(getFirebaseDb());
  const integrations = await service.listIntegrations(currentWorkspace);

  response.json({ integrations });
}

export async function getIntegrationDetail(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new IntegrationService(getFirebaseDb());
  const detail = await service.getIntegrationDetail(currentWorkspace, getProvider(request), user.id);

  response.json(detail);
}

export async function connectIntegration(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new IntegrationService(getFirebaseDb());
  const result = await service.createConnectUrl(currentWorkspace, user.id, getProvider(request));

  response.json(result);
}

export async function integrationCallback(request: Request, response: Response) {
  const service = new IntegrationService(getFirebaseDb());
  const redirectUrl = await service.handleOAuthCallback(getProvider(request), {
    code: typeof request.query.code === "string" ? request.query.code : undefined,
    state: typeof request.query.state === "string" ? request.query.state : undefined,
    error: typeof request.query.error === "string" ? request.query.error : undefined,
  });

  response.redirect(302, redirectUrl);
}

export async function syncIntegration(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new IntegrationService(getFirebaseDb());
  const result = await service.triggerSync(currentWorkspace, getProvider(request), user.id);

  response.json(result);
}

export async function disconnectIntegration(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new IntegrationService(getFirebaseDb());
  const result = await service.disconnectIntegration(currentWorkspace, getProvider(request), user.id);

  response.json(result);
}

export async function gmailPubSubWebhook(request: Request, response: Response) {
  const service = new GmailPubSubService(getFirebaseDb());
  const result = await service.enqueueDeltaJobs(request.body, request.header("authorization") ?? undefined);
  response.status(202).json(result);
}

export async function hubspotWebhook(request: Request, response: Response) {
  const service = new HubspotWebhookService(getFirebaseDb());
  const rawBody = (request as any).rawBody ?? JSON.stringify(request.body); // Fallback if rawBody isn't parsed
  const signature = request.header("x-hubspot-signature-v3") ?? request.header("x-hubspot-signature");
  const timestamp = request.header("x-hubspot-request-timestamp") ?? undefined;
  const requestUrl = `${env.API_BASE_URL ?? ""}${request.originalUrl}`;

  const result = await service.enqueueDeltaJobs(request.body, {
    signature: signature ?? undefined,
    rawBody,
    timestamp,
    method: request.method,
    requestUrl,
  });
  response.status(202).json(result);
}

export async function renewGmailWatches(request: Request, response: Response) {
  const providedKey = request.header("x-internal-key");

  if (!env.INTERNAL_API_KEY || providedKey !== env.INTERNAL_API_KEY) {
    throw new ApiError({
      code: "UNAUTHORIZED",
      message: "Internal API key is missing or invalid.",
      status: 401,
    });
  }

  const service = new GmailSyncService(getFirebaseDb());
  const result = await service.renewExpiringWatches();
  response.json(result);
}

export async function getIntegrationWorkspace(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new IntegrationWorkspaceService(getFirebaseDb());
  const provider = getProvider(request);
  const query = typeof request.query.q === "string" ? request.query.q : undefined;
  const module =
    request.query.module === "contacts" ||
    request.query.module === "companies" ||
    request.query.module === "deals" ||
    request.query.module === "notes" ||
    request.query.module === "tasks"
      ? request.query.module
      : undefined;

  const result = await service.getWorkspaceData(currentWorkspace, user.id, provider, { query, module });
  response.json(result);
}

export async function getIntegrationItemDetail(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new IntegrationWorkspaceService(getFirebaseDb());
  const provider = getProvider(request);
  const module =
    request.query.module === "contacts" ||
    request.query.module === "companies" ||
    request.query.module === "deals" ||
    request.query.module === "notes" ||
    request.query.module === "tasks"
      ? request.query.module
      : undefined;

  const result = await service.getSelectedItemDetail(currentWorkspace, user.id, provider, {
    itemId: getItemId(request),
    module,
  });
  response.json(result);
}

export async function runIntegrationAction(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new IntegrationWorkspaceService(getFirebaseDb());
  const provider = getProvider(request);
  const action = getAction(request);

  if (provider === "gmail") {
    if (action === "summarizeThread") {
      return response.json(await service.summarizeGmailThread(currentWorkspace, user.id, request.body.threadId));
    }

    if (action === "extractActionItems") {
      return response.json(await service.extractGmailActionItems(currentWorkspace, user.id, request.body.threadId));
    }

    if (action === "draftReply") {
      return response.json(
        await service.draftGmailReply(
          currentWorkspace,
          user.id,
          request.body.threadId,
          typeof request.body.tone === "string" ? request.body.tone : undefined,
        ),
      );
    }

    if (action === "createDraft") {
      return response.json(
        await service.createGmailDraft(currentWorkspace, user.id, {
          threadId: typeof request.body.threadId === "string" ? request.body.threadId : undefined,
          to: Array.isArray(request.body.to) ? request.body.to : [],
          cc: Array.isArray(request.body.cc) ? request.body.cc : [],
          subject: typeof request.body.subject === "string" ? request.body.subject : undefined,
          body: typeof request.body.body === "string" ? request.body.body : undefined,
        }),
      );
    }

    if (action === "prepareSendApproval") {
      return response.json(
        await service.prepareGmailSendApproval(currentWorkspace, user.id, {
          threadId: typeof request.body.threadId === "string" ? request.body.threadId : undefined,
          to: Array.isArray(request.body.to) ? request.body.to : [],
          cc: Array.isArray(request.body.cc) ? request.body.cc : [],
          subject: typeof request.body.subject === "string" ? request.body.subject : undefined,
          body: typeof request.body.body === "string" ? request.body.body : undefined,
        }),
      );
    }

    if (action === "saveThreadSummary") {
      return response.json(await service.saveGmailThreadSummary(currentWorkspace, user.id, request.body.threadId));
    }

    if (action === "createFollowUpWorkflow") {
      return response.json(
        await service.createGmailFollowUpWorkflow(currentWorkspace, user.id, request.body.threadId),
      );
    }
  }

  if (provider === "hubspot") {
    const module =
      request.body.module === "contacts" ||
      request.body.module === "companies" ||
      request.body.module === "deals" ||
      request.body.module === "notes" ||
      request.body.module === "tasks"
        ? request.body.module
        : "contacts";

    if (action === "summarizeRecord") {
      return response.json(
        await service.summarizeHubSpotRecord(currentWorkspace, user.id, {
          module,
          recordId: request.body.recordId,
        }),
      );
    }

    if (action === "draftFollowUp") {
      return response.json(
        await service.draftHubSpotFollowUp(currentWorkspace, user.id, {
          module,
          recordId: request.body.recordId,
        }),
      );
    }

    if (action === "createNoteDraft") {
      return response.json(
        await service.createHubSpotNoteDraft(currentWorkspace, user.id, {
          module,
          recordId: request.body.recordId,
        }),
      );
    }

    if (action === "prepareUpdateApproval") {
      return response.json(
        await service.prepareHubSpotUpdateApproval(currentWorkspace, user.id, {
          module,
          recordId: request.body.recordId,
          updates:
            request.body.updates && typeof request.body.updates === "object" && !Array.isArray(request.body.updates)
              ? request.body.updates
              : {},
          title: typeof request.body.title === "string" ? request.body.title : undefined,
        }),
      );
    }

    if (action === "prepareNoteApproval") {
      return response.json(
        await service.prepareHubSpotNoteApproval(currentWorkspace, user.id, {
          module,
          recordId: request.body.recordId,
          body: typeof request.body.body === "string" ? request.body.body : "",
          title: typeof request.body.title === "string" ? request.body.title : undefined,
        }),
      );
    }

    if (action === "prepareTaskCreateApproval") {
      return response.json(
        await service.prepareHubSpotTaskCreateApproval(currentWorkspace, user.id, {
          module,
          recordId: request.body.recordId,
          subject: typeof request.body.subject === "string" ? request.body.subject : "",
          body: typeof request.body.body === "string" ? request.body.body : undefined,
          dueAt: typeof request.body.dueAt === "string" ? request.body.dueAt : undefined,
          status: typeof request.body.status === "string" ? request.body.status : undefined,
          priority: typeof request.body.priority === "string" ? request.body.priority : undefined,
          title: typeof request.body.title === "string" ? request.body.title : undefined,
        }),
      );
    }

    if (action === "prepareTaskUpdateApproval") {
      return response.json(
        await service.prepareHubSpotTaskUpdateApproval(currentWorkspace, user.id, {
          recordId: request.body.recordId,
          updates:
            request.body.updates && typeof request.body.updates === "object" && !Array.isArray(request.body.updates)
              ? request.body.updates
              : {},
          title: typeof request.body.title === "string" ? request.body.title : undefined,
        }),
      );
    }

    if (action === "prepareAssociationApproval") {
      return response.json(
        await service.prepareHubSpotAssociationApproval(currentWorkspace, user.id, {
          module,
          recordId: request.body.recordId,
          relatedModule:
            request.body.relatedModule === "contacts" ||
            request.body.relatedModule === "companies" ||
            request.body.relatedModule === "deals" ||
            request.body.relatedModule === "notes" ||
            request.body.relatedModule === "tasks"
              ? request.body.relatedModule
              : "contacts",
          relatedRecordId: request.body.relatedRecordId,
          action: request.body.action === "remove" ? "remove" : "add",
          title: typeof request.body.title === "string" ? request.body.title : undefined,
        }),
      );
    }

    if (action === "prepareCreateApproval") {
      return response.json(
        await service.prepareHubSpotCreateApproval(currentWorkspace, user.id, {
          module,
          properties:
            request.body.properties && typeof request.body.properties === "object" && !Array.isArray(request.body.properties)
              ? request.body.properties
              : {},
          title: typeof request.body.title === "string" ? request.body.title : undefined,
        }),
      );
    }

    if (action === "createRecordWorkflow") {
      return response.json(
        await service.createHubSpotRecordWorkflow(currentWorkspace, user.id, {
          module,
          recordId: request.body.recordId,
        }),
      );
    }
  }

  throw new ApiError({
    code: "NOT_SUPPORTED",
    message: `Action "${action}" is not supported for provider "${provider}".`,
    status: 400,
  });
}

export async function getGmailStyleProfile(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new IntegrationWorkspaceService(getFirebaseDb());
  const profile = await service.getGmailStyleProfile(currentWorkspace, user.id);
  response.json({ profile: serializeGmailStyleProfile(profile) });
}

export async function analyzeGmailStyleProfile(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new IntegrationWorkspaceService(getFirebaseDb());
  const sampleSize = typeof request.body.sampleSize === "number" ? request.body.sampleSize : undefined;
  const profile = await service.analyzeGmailStyleProfile(currentWorkspace, user.id, sampleSize);
  response.json({ profile: serializeGmailStyleProfile(profile) });
}

export async function deleteGmailStyleProfile(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new IntegrationWorkspaceService(getFirebaseDb());
  const result = await service.deleteGmailStyleProfile(currentWorkspace, user.id);
  response.json(result);
}
