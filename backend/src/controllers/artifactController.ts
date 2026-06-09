import type { Request, Response } from "express";

import { ArtifactService } from "../artifacts/artifactService.js";
import { requireUser } from "../auth/authMiddleware.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";
import { ApiError } from "../utils/apiError.js";

function getRouteId(request: Request) {
  const id = request.params.id;

  if (!id || Array.isArray(id)) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      message: "Artifact ID is required.",
      status: 400,
    });
  }

  return id;
}

export async function listArtifacts(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const service = new ArtifactService(getFirebaseDb());
  const artifacts = await service.listArtifacts(currentWorkspace.workspace, {
    artifactType: typeof request.query.artifactType === "string" ? request.query.artifactType : undefined,
    agentId: typeof request.query.agentId === "string" ? request.query.agentId : undefined,
    workflowId: typeof request.query.workflowId === "string" ? request.query.workflowId : undefined,
    limit: typeof request.query.limit === "number" ? request.query.limit : undefined,
  });

  response.json({ artifacts });
}

export async function getArtifact(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const service = new ArtifactService(getFirebaseDb());
  const artifact = await service.getArtifact(currentWorkspace.workspace, getRouteId(request));

  response.json(service.serializeArtifact(artifact));
}

export async function createArtifact(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const service = new ArtifactService(getFirebaseDb());
  const artifact = await service.createArtifact({
    workspace: currentWorkspace.workspace,
    userId: user.id,
    title: request.body.title,
    artifactType: request.body.artifactType,
    content: request.body.content,
    sourceRefs: request.body.sourceRefs,
    inputHash: request.body.inputHash,
  });

  response.status(201).json({ artifactId: artifact.id });
}

export async function deleteArtifact(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const service = new ArtifactService(getFirebaseDb());
  await service.deleteArtifact(currentWorkspace.workspace, getRouteId(request));
  response.status(204).send();
}
