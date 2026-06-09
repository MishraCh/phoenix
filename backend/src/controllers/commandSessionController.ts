import type { Request, Response } from "express";

import { requireUser } from "../auth/authMiddleware.js";
import { CommandSessionService } from "../commandSessions/commandSessionService.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { SavedItemService } from "../savedItems/savedItemService.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";

function sessionId(request: Request): string {
  const id = request.params.id;
  if (!id || typeof id !== "string") {
    throw new Error("Session ID is required.");
  }
  return id;
}

function messageId(request: Request): string {
  const id = request.params.messageId;
  if (!id || typeof id !== "string") {
    throw new Error("Message ID is required.");
  }
  return id;
}

function serializeSession(session: Awaited<ReturnType<CommandSessionService["getOrCreate"]>>) {
  return {
    id: session.id,
    title: session.title,
    mode: session.mode,
    source: session.source,
    status: session.status,
    pinned: session.pinned,
    bookmarked: session.bookmarked,
    firstQuery: session.firstQuery,
    lastMessagePreview: session.lastMessagePreview,
    turnCount: session.turnCount,
    artifactIds: session.artifactIds,
    createdAt: session.createdAt.toDate().toISOString(),
    updatedAt: session.updatedAt.toDate().toISOString(),
  };
}

function serializeMessage(
  msg: {
    id: string;
    role: string;
    content: string;
    responseJson?: string;
    mode: string;
    source: string;
    agentId?: string;
    agentName?: string;
    sourceRefs: unknown[];
    artifactIds: string[];
    starredByUserIds?: string[];
    savedItemId?: string;
    createdAt: { toDate: () => Date };
  },
) {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    responseJson: msg.responseJson,
    mode: msg.mode,
    source: msg.source,
    agentId: msg.agentId ?? null,
    agentName: msg.agentName ?? null,
    sourceRefs: msg.sourceRefs,
    artifactIds: msg.artifactIds,
    starredByUserIds: msg.starredByUserIds ?? [],
    savedItemId: msg.savedItemId ?? null,
    createdAt: msg.createdAt.toDate().toISOString(),
  };
}

function serializeSavedItem(savedItem: {
  id: string;
  sourceType: string;
  sourceSessionId?: string;
  sourceAssistantMessageId?: string;
  sourceWorkflowRunId?: string;
  itemType: string;
  title: string;
  previewText: string;
  contentText: string;
  responseJson?: string;
  mode?: string;
  sourceRefs: unknown[];
  createdByUserId: string;
  promotedArtifactId?: string;
  createdAt: { toDate: () => Date };
  updatedAt: { toDate: () => Date };
}) {
  return {
    id: savedItem.id,
    sourceType: savedItem.sourceType,
    sourceSessionId: savedItem.sourceSessionId ?? null,
    sourceAssistantMessageId: savedItem.sourceAssistantMessageId ?? null,
    sourceWorkflowRunId: savedItem.sourceWorkflowRunId ?? null,
    itemType: savedItem.itemType,
    title: savedItem.title,
    previewText: savedItem.previewText,
    contentText: savedItem.contentText,
    responseJson: savedItem.responseJson ?? null,
    mode: savedItem.mode ?? null,
    sourceRefs: savedItem.sourceRefs,
    createdByUserId: savedItem.createdByUserId,
    promotedArtifactId: savedItem.promotedArtifactId ?? null,
    createdAt: savedItem.createdAt.toDate().toISOString(),
    updatedAt: savedItem.updatedAt.toDate().toISOString(),
  };
}

export async function listCommandSessions(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new CommandSessionService(getFirebaseDb());
  
  const sourceParam = typeof request.query.source === "string" ? request.query.source : "web";
  const sourceFilter = ["web", "email", "whatsapp", "api", "slack"].includes(sourceParam) 
    ? (sourceParam as "web" | "email" | "whatsapp" | "api" | "slack") 
    : "web";

  const sessions = await service.listRecent(workspace, 20, sourceFilter);
  response.json({ sessions: sessions.map(serializeSession) });
}

export async function getCommandSession(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new CommandSessionService(getFirebaseDb());
  const { session, messages } = await service.getWithMessages(workspace, sessionId(request));
  response.json({
    ...serializeSession(session),
    messages: messages.map(serializeMessage),
  });
}

export async function updateCommandSession(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new CommandSessionService(getFirebaseDb());
  await service.update(workspace, sessionId(request), request.body as { title?: string; pinned?: boolean; bookmarked?: boolean; status?: "active" | "archived" });
  response.json({ ok: true });
}

export async function bookmarkCommandSession(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new CommandSessionService(getFirebaseDb());
  const { session } = await service.getWithMessages(workspace, sessionId(request));
  await service.update(workspace, sessionId(request), { bookmarked: !session.bookmarked });
  response.json({ bookmarked: !session.bookmarked });
}

export async function pinCommandSession(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new CommandSessionService(getFirebaseDb());
  const { session } = await service.getWithMessages(workspace, sessionId(request));
  await service.update(workspace, sessionId(request), { pinned: !session.pinned });
  response.json({ pinned: !session.pinned });
}

export async function starCommandSessionMessage(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new CommandSessionService(getFirebaseDb());
  const starred = await service.starAssistantMessage(workspace, sessionId(request), messageId(request), user.id);
  response.json({ starred });
}

export async function unstarCommandSessionMessage(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new CommandSessionService(getFirebaseDb());
  const starred = await service.unstarAssistantMessage(workspace, sessionId(request), messageId(request), user.id);
  response.json({ starred });
}

export async function saveCommandSessionMessage(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new SavedItemService(getFirebaseDb());
  const savedItem = await service.saveAssistantResponse(workspace, user.id, sessionId(request), messageId(request));
  response.status(201).json({ savedItem: serializeSavedItem(savedItem) });
}

export async function createArtifactFromCommandSessionMessage(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new SavedItemService(getFirebaseDb());
  const artifact = await service.createArtifactFromAssistantResponse(
    workspace,
    user.id,
    sessionId(request),
    messageId(request),
    {
      title: typeof request.body.title === "string" ? request.body.title : undefined,
      artifactType: request.body.artifactType,
    },
  );
  response.status(201).json({ artifactId: artifact.id });
}
