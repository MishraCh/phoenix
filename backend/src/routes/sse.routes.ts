import { Router } from "express";
import type { Request, Response } from "express";

import { getFirebaseAuth, getFirebaseDb } from "../config/firebaseAdmin.js";
import { coalesceUserRead } from "../cache/requestStateCache.js";
import { UserRepository } from "../repositories/userRepository.js";
import { CommandSessionRepository } from "../repositories/commandSessionRepository.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";
import { sseManager } from "../sse/sseManager.js";
import { ApiError } from "../utils/apiError.js";

export const sseRouter = Router();

async function resolveUserAndWorkspace(token: string, req: Request) {
  let decoded;
  try {
    decoded = await getFirebaseAuth().verifyIdToken(token);
  } catch {
    throw new ApiError({ code: "UNAUTHORIZED", message: "Invalid Firebase token.", status: 401 });
  }

  if (!decoded.email) {
    throw new ApiError({ code: "UNAUTHORIZED", message: "Token must have an email.", status: 401 });
  }

  const userRepo = new UserRepository(getFirebaseDb());
  const user = await coalesceUserRead(decoded.uid, () => userRepo.getUser(decoded.uid));

  if (!user) {
    throw new ApiError({ code: "UNAUTHORIZED", message: "User not found.", status: 401 });
  }

  // Attach user so resolveCurrentWorkspace can use it
  req.user = {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    defaultWorkspaceId: user.defaultWorkspaceId,
  };

  const workspace = await resolveCurrentWorkspace(user, req);
  return { user, workspaceId: workspace.id };
}

function sseError(res: Response, status: number, message: string) {
  if (!res.headersSent) {
    res.status(status).json({ error: message });
  }
}

// GET /events?scope=workspace — one stream per workspace, covers approvals + notifications + command progress
sseRouter.get("/events", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : null;
  if (!token) return sseError(res, 401, "Missing ?token query parameter.");

  try {
    const { workspaceId } = await resolveUserAndWorkspace(token, req);
    sseManager.register(res, workspaceId, [`workspace:${workspaceId}`]);
  } catch (err) {
    if (err instanceof ApiError) return sseError(res, err.status, err.message);
    return sseError(res, 500, "SSE connection failed.");
  }
});

// GET /command-sessions/:sessionId/events — session-scoped stream with step-level command progress
sseRouter.get("/command-sessions/:sessionId/events", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : null;
  if (!token) return sseError(res, 401, "Missing ?token query parameter.");

  const { sessionId } = req.params;
  if (!sessionId) return sseError(res, 400, "Session ID required.");

  try {
    const { workspaceId } = await resolveUserAndWorkspace(token, req);

    const repo = new CommandSessionRepository(getFirebaseDb());
    const session = await repo.get(workspaceId, sessionId);

    if (!session || session.workspaceId !== workspaceId) {
      return sseError(res, 403, "Session not accessible.");
    }

    sseManager.register(res, workspaceId, [
      `workspace:${workspaceId}`,
      `session:${sessionId}`,
    ]);
  } catch (err) {
    if (err instanceof ApiError) return sseError(res, err.status, err.message);
    return sseError(res, 500, "SSE connection failed.");
  }
});

// GET /workflows/:workflowId/runs/:runId/events — run-scoped stream for step-by-step progress
sseRouter.get("/workflows/:workflowId/runs/:runId/events", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : null;
  if (!token) return sseError(res, 401, "Missing ?token query parameter.");

  const { workflowId, runId } = req.params;
  if (!workflowId || !runId) return sseError(res, 400, "workflowId and runId required.");

  try {
    const { workspaceId } = await resolveUserAndWorkspace(token, req);

    const runSnap = await getFirebaseDb()
      .collection("workspaces")
      .doc(workspaceId)
      .collection("workflowRuns")
      .doc(runId)
      .get();

    if (!runSnap.exists || runSnap.data()?.workflowId !== workflowId) {
      return sseError(res, 403, "Workflow run not accessible.");
    }

    sseManager.register(res, workspaceId, [
      `workspace:${workspaceId}`,
      `run:${runId}`,
    ]);
  } catch (err) {
    if (err instanceof ApiError) return sseError(res, err.status, err.message);
    return sseError(res, 500, "SSE connection failed.");
  }
});
