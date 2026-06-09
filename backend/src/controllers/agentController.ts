import type { Request, Response } from "express";

import { getVisibleAgent, resolveAgent, visibleAgentRegistry } from "../agents/agentRegistry.js";
import { requireUser } from "../auth/authMiddleware.js";
import { CommandService } from "../command/commandService.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { timeRequestPhase } from "../observability/requestTiming.js";
import { AgentConfigRepository } from "../repositories/agentConfigRepository.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";
import { UsageService } from "../usage/usageService.js";
import { ApiError } from "../utils/apiError.js";

export async function listAgents(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const usageService = new UsageService(getFirebaseDb());

  const [allowedAgentIds, workspaceConfigs] = await Promise.all([
    timeRequestPhase(request, "agents.accessible_ids", async () =>
      usageService.getAccessibleAgentIds(currentWorkspace.workspace),
    ),
    timeRequestPhase(request, "agents.workspace_configs", () =>
      new AgentConfigRepository(getFirebaseDb()).list(currentWorkspace.id),
    ),
  ]);

  const configMap = new Map(workspaceConfigs.map((c) => [c.agentId, c]));

  response.json({
    agents: visibleAgentRegistry
      .filter((agent) => allowedAgentIds.includes(agent.id))
      .map((agent) => {
        const resolved = resolveAgent(agent, configMap.get(agent.id) ?? null);
        return {
          id: resolved.id,
          name: resolved.name,
          type: resolved.type,
          status: resolved.status,
          description: resolved.description,
          systemPromptAddition: resolved.systemPromptAddition,
          contextBundleId: resolved.contextBundleId,
        };
      }),
  });
}

export async function getAgent(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const agentId = request.params.id;

  if (!agentId || Array.isArray(agentId)) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      message: "Agent ID is required.",
      status: 400,
    });
  }

  const registryAgent = getVisibleAgent(agentId);
  if (!registryAgent) {
    throw new ApiError({
      code: "NOT_FOUND",
      message: "Agent not found.",
      status: 404,
    });
  }

  new UsageService(getFirebaseDb()).assertAgentAllowedForPlan(currentWorkspace.workspace, agentId);

  const workspaceConfig = await new AgentConfigRepository(getFirebaseDb()).get(currentWorkspace.id, agentId);
  const resolved = resolveAgent(registryAgent, workspaceConfig);

  response.json(resolved);
}

export async function updateAgentConfig(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const agentId = request.params.id;

  if (!agentId || Array.isArray(agentId)) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      message: "Agent ID is required.",
      status: 400,
    });
  }

  const registryAgent = getVisibleAgent(agentId);
  if (!registryAgent) {
    throw new ApiError({
      code: "NOT_FOUND",
      message: "Agent not found.",
      status: 404,
    });
  }

  new UsageService(getFirebaseDb()).assertAgentAllowedForPlan(currentWorkspace.workspace, agentId);

  const agentConfigRepo = new AgentConfigRepository(getFirebaseDb());
  const updatedConfig = await agentConfigRepo.upsert(currentWorkspace.id, agentId, {
    status: request.body.status,
    systemPromptAddition: request.body.systemPromptAddition,
    allowedTools: request.body.allowedTools,
    contextBundleId: request.body.contextBundleId,
  });

  response.json(resolveAgent(registryAgent, updatedConfig));
}

export async function runAgent(request: Request, response: Response) {
  const user = requireUser(request);
  const agentId = request.params.id;

  if (!agentId || Array.isArray(agentId)) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      message: "Agent ID is required.",
      status: 400,
    });
  }

  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  new UsageService(getFirebaseDb()).assertAgentAllowedForPlan(currentWorkspace.workspace, agentId);
  const service = new CommandService(getFirebaseDb());
  const result = await service.runCommand({
    input: request.body.input,
    mode: request.body.mode,
    agentId,
    contextBundleId: request.body.contextBundleId,
    attachments: Array.isArray(request.body.attachments) ? request.body.attachments : [],
    currentWorkspace,
    userId: user.id,
    request,
  });

  response.json(result);
}
