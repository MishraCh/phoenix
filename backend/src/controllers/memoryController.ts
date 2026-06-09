import type { Request, Response } from "express";

import { requireUser } from "../auth/authMiddleware.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { MemoryService } from "../memory/memoryService.js";
import type { MemoryNodeStatus, MemoryNodeType } from "../schemas/coreSchemas.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";

const validStatuses = new Set<MemoryNodeStatus>(["active", "needs_review", "archived"]);
const validTypes = new Set<MemoryNodeType>(["fact", "preference", "pattern", "contact", "decision"]);

function memoryId(request: Request): string {
  const id = request.params.id;
  if (!id || typeof id !== "string") throw new Error("Memory ID is required.");
  return id;
}

export async function listMemory(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new MemoryService(getFirebaseDb());

  const rawStatus = typeof request.query.status === "string" ? request.query.status : undefined;
  const rawType = typeof request.query.type === "string" ? request.query.type : undefined;

  const status = rawStatus && validStatuses.has(rawStatus as MemoryNodeStatus)
    ? (rawStatus as MemoryNodeStatus)
    : undefined;
  const type = rawType && validTypes.has(rawType as MemoryNodeType)
    ? (rawType as MemoryNodeType)
    : undefined;

  const nodes = await service.list(workspace, { status, type, limit: 200 });

  response.json({ memory: nodes.map((n) => service.serializeNode(n)) });
}

export async function createMemory(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new MemoryService(getFirebaseDb());

  const node = await service.create(workspace, {
    type: request.body.type,
    content: request.body.content,
    source: "user",
    confidence: request.body.confidence,
    status: request.body.status ?? "active",
  });

  response.status(201).json(service.serializeNode(node));
}

export async function updateMemory(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new MemoryService(getFirebaseDb());

  const node = await service.update(workspace, memoryId(request), {
    status: request.body.status,
    content: request.body.content,
    confidence: request.body.confidence,
  });

  response.json(service.serializeNode(node));
}

export async function deleteMemory(request: Request, response: Response) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  const service = new MemoryService(getFirebaseDb());

  await service.delete(workspace, memoryId(request));
  response.json({ ok: true });
}
