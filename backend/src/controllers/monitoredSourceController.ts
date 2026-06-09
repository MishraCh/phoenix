import type { Request, Response } from "express";

import { requireUser } from "../auth/authMiddleware.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";
import { MonitoredSourceService } from "../web/monitoredSourceService.js";
import { ApiError } from "../utils/apiError.js";
import type { MonitoredSource } from "../schemas/coreSchemas.js";

function requiredParam(request: Request, name: string) {
  const value = request.params[name];

  if (!value || Array.isArray(value)) {
    throw new ApiError({ code: "VALIDATION_ERROR", message: `${name} is required.`, status: 400 });
  }

  return value;
}

function serializeSource(source: MonitoredSource) {
  return {
    id: source.id,
    workspaceId: source.workspaceId,
    type: source.type,
    value: source.value,
    frequency: source.frequency,
    status: source.status,
    lastCheckedAt: source.lastCheckedAt ? source.lastCheckedAt.toDate().toISOString() : null,
    lastChangedAt: source.lastChangedAt ? source.lastChangedAt.toDate().toISOString() : null,
    createdAt: source.createdAt.toDate().toISOString(),
    updatedAt: source.updatedAt.toDate().toISOString(),
  };
}

export async function listMonitoredSources(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new MonitoredSourceService(getFirebaseDb());
  const sources = await service.list(currentWorkspace.id);
  response.json({ sources: sources.map(serializeSource) });
}

export async function createMonitoredSource(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new MonitoredSourceService(getFirebaseDb());
  const source = await service.create({
    currentWorkspace,
    userId: user.id,
    type: request.body.type,
    value: request.body.value,
    frequency: request.body.frequency,
    workflowId: request.body.workflowId,
  });

  response.status(201).json({ monitoredSourceId: source.id, source: serializeSource(source) });
}

export async function getMonitoredSource(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new MonitoredSourceService(getFirebaseDb());
  const source = await service.getById(currentWorkspace.id, requiredParam(request, "id"));
  response.json({ source: serializeSource(source) });
}

export async function updateMonitoredSource(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new MonitoredSourceService(getFirebaseDb());
  const source = await service.update(currentWorkspace.id, requiredParam(request, "id"), {
    status: request.body.status,
    frequency: request.body.frequency,
  });

  response.json({ source: serializeSource(source) });
}

export async function runMonitorCheck(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new MonitoredSourceService(getFirebaseDb());
  const result = await service.runCheck({
    currentWorkspace,
    userId: user.id,
    sourceId: requiredParam(request, "id"),
    objective: typeof request.body.objective === "string" ? request.body.objective : undefined,
    processor: request.body.processor ?? "core",
  });

  response.json(result);
}
