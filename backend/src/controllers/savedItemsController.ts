import type { Request, Response } from "express";

import { requireUser } from "../auth/authMiddleware.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { SavedItemService } from "../savedItems/savedItemService.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";

function savedItemId(request: Request): string {
  const id = request.params.id;
  if (!id || typeof id !== "string") {
    throw new Error("Saved item ID is required.");
  }
  return id;
}

function serializeSavedItem(savedItem: Awaited<ReturnType<SavedItemService["getSavedItem"]>>) {
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

export async function listSavedItems(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new SavedItemService(getFirebaseDb());
  const savedItems = await service.listSavedItems(workspace);
  response.json({ savedItems: savedItems.map(serializeSavedItem) });
}

export async function getSavedItem(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new SavedItemService(getFirebaseDb());
  const savedItem = await service.getSavedItem(workspace, savedItemId(request));
  response.json({ savedItem: serializeSavedItem(savedItem) });
}

export async function deleteSavedItem(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new SavedItemService(getFirebaseDb());
  await service.deleteSavedItem(workspace, savedItemId(request));
  response.status(204).send();
}

export async function promoteSavedItem(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new SavedItemService(getFirebaseDb());
  const artifact = await service.promoteSavedItem(workspace, user.id, savedItemId(request), {
    title: typeof request.body.title === "string" ? request.body.title : undefined,
    artifactType: request.body.artifactType,
  });
  response.status(201).json({ artifactId: artifact.id });
}
