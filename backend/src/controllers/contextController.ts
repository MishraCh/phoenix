import type { Request, Response } from "express";

import { requireUser } from "../auth/authMiddleware.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { ContextService } from "../context/contextService.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";

export async function listContextBundles(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const service = new ContextService(getFirebaseDb());
  const bundles = await service.listBundles(currentWorkspace.workspace);

  response.json({
    bundles,
    warnings: bundles[0]?.missingSources ?? ["Connected integrations", "Workspace/company memory"],
  });
}

export async function createContextBundle(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const service = new ContextService(getFirebaseDb());
  const result = await service.buildOrReuseBundle({
    workspace: currentWorkspace.workspace,
    userId: user.id,
    key: request.body.key,
    purpose: request.body.purpose,
    sourceRefs: request.body.sourceRefs,
    payload: request.body.payload,
    ttlMinutes: request.body.ttlMinutes,
  });

  response.status(result.reused ? 200 : 201).json({
    bundle: service.serializeBundle(result.bundle),
    reused: result.reused,
  });
}
