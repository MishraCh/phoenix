import type { AgentConfig, Approval, Artifact, CommandSession, MemoryNode, User, Workflow } from "../schemas/coreSchemas.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { logger } from "../observability/logger.js";

const CACHE_TTL_MS = 5 * 60 * 1000;         // user + workspace: 5 minutes
const CAPABILITIES_TTL_MS = 3 * 60 * 1000;  // capabilities: 3 minutes
const DASHBOARD_SUMMARY_TTL_MS = 3 * 60 * 1000; // dashboard: 3 minutes (raised from 60s to reduce Firestore reads)
const AGENT_CONFIGS_TTL_MS = 2 * 60 * 1000; // agent configs: 2 minutes
const WORKFLOWS_TTL_MS = 30 * 1000;         // workflow list: 30 seconds
const ARTIFACTS_TTL_MS = 30 * 1000;         // artifact list: 30 seconds
const APPROVALS_TTL_MS = 20 * 1000;         // approval list: 20 seconds
const COMMAND_SESSIONS_TTL_MS = 20 * 1000;  // session list: 20 seconds
const MEMORY_TTL_MS = 30 * 1000;            // memory list: 30 seconds
const INTEGRATIONS_COUNT_TTL_MS = 3 * 60 * 1000; // integration count: 3 minutes

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const userCache = new Map<string, CacheEntry<User>>();
const currentWorkspaceCache = new Map<string, CacheEntry<CurrentWorkspace>>();
const capabilitiesCache = new Map<string, CacheEntry<string[]>>();
const dashboardSummaryCache = new Map<string, CacheEntry<unknown>>();
const agentConfigsCache = new Map<string, CacheEntry<AgentConfig[]>>();
const workflowsCache = new Map<string, CacheEntry<Workflow[]>>();
const artifactsCache = new Map<string, CacheEntry<Artifact[]>>();
const approvalsCache = new Map<string, CacheEntry<Approval[]>>();
const commandSessionsCache = new Map<string, CacheEntry<CommandSession[]>>();
const memoryCache = new Map<string, CacheEntry<MemoryNode[]>>();
const integrationsCountCache = new Map<string, CacheEntry<number>>();

// In-flight promise maps — prevent concurrent requests from each launching a separate DB read
const userReadInflight = new Map<string, Promise<User | null>>();
const workspaceResolveInflight = new Map<string, Promise<CurrentWorkspace>>();

function isFresh<T>(entry: CacheEntry<T> | undefined) {
  return Boolean(entry && entry.expiresAt > Date.now());
}

function getWorkspaceCacheKey(userId: string, defaultWorkspaceId?: string | null) {
  return `${userId}:${defaultWorkspaceId ?? "none"}`;
}

// ─── User cache ────────────────────────────────────────────────────────────────

export function getCachedUser(userId: string) {
  const cached = userCache.get(userId);

  if (!isFresh(cached)) {
    if (cached) userCache.delete(userId);
    return null;
  }

  return cached!.value;
}

export function setCachedUser(user: User) {
  userCache.set(user.id, {
    value: user,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export function invalidateCachedUser(userId: string) {
  userCache.delete(userId);
}

/**
 * Coalesced user read — if a Firestore fetch for this userId is already in flight,
 * the caller awaits the same promise instead of launching a duplicate read.
 */
export function coalesceUserRead(
  userId: string,
  readFn: () => Promise<User | null>,
): Promise<User | null> {
  const cached = getCachedUser(userId);
  if (cached) return Promise.resolve(cached);

  const inflight = userReadInflight.get(userId);
  if (inflight) return inflight;

  const promise = readFn().finally(() => userReadInflight.delete(userId));
  userReadInflight.set(userId, promise);
  return promise;
}

// ─── Workspace cache ───────────────────────────────────────────────────────────

export function getCachedCurrentWorkspace(userId: string, defaultWorkspaceId?: string | null) {
  const key = getWorkspaceCacheKey(userId, defaultWorkspaceId);
  const cached = currentWorkspaceCache.get(key);

  if (!isFresh(cached)) {
    if (cached) currentWorkspaceCache.delete(key);
    return null;
  }

  return cached!.value;
}

export function setCachedCurrentWorkspace(
  userId: string,
  defaultWorkspaceId: string | null | undefined,
  currentWorkspace: CurrentWorkspace,
) {
  currentWorkspaceCache.set(getWorkspaceCacheKey(userId, defaultWorkspaceId), {
    value: currentWorkspace,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export function invalidateCachedCurrentWorkspace(userId: string) {
  for (const key of currentWorkspaceCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      currentWorkspaceCache.delete(key);
    }
  }
}

/**
 * Coalesced workspace resolve — if a workspace resolution for this user+workspace combo
 * is already in flight, callers await the same promise instead of each doing two Firestore reads.
 */
export function coalesceWorkspaceResolve(
  userId: string,
  workspaceId: string,
  resolveFn: () => Promise<CurrentWorkspace>,
): Promise<CurrentWorkspace> {
  const key = `${userId}:${workspaceId}`;
  const inflight = workspaceResolveInflight.get(key);
  if (inflight) return inflight;

  const promise = resolveFn().finally(() => workspaceResolveInflight.delete(key));
  workspaceResolveInflight.set(key, promise);
  return promise;
}

// ─── Capabilities cache ────────────────────────────────────────────────────────

export function getCachedCapabilities(workspaceId: string): string[] | null {
  const cached = capabilitiesCache.get(workspaceId);

  if (!isFresh(cached)) {
    if (cached) capabilitiesCache.delete(workspaceId);
    return null;
  }

  return cached!.value;
}

export function setCachedCapabilities(workspaceId: string, capabilities: string[]) {
  capabilitiesCache.set(workspaceId, {
    value: capabilities,
    expiresAt: Date.now() + CAPABILITIES_TTL_MS,
  });
}

export function invalidateCachedCapabilities(workspaceId: string) {
  capabilitiesCache.delete(workspaceId);
}

// ─── Dashboard summary cache ───────────────────────────────────────────────────
// Keyed by workspaceId:userId so different users in the same workspace see their
// own unreadNotificationCount rather than a shared workspace-level value.

export function getCachedDashboardSummary(workspaceId: string, userId: string): unknown | null {
  const key = `${workspaceId}:${userId}`;
  const cached = dashboardSummaryCache.get(key);

  if (!isFresh(cached)) {
    if (cached) dashboardSummaryCache.delete(key);
    return null;
  }

  return cached!.value;
}

export function setCachedDashboardSummary(workspaceId: string, userId: string, summary: unknown) {
  const key = `${workspaceId}:${userId}`;
  dashboardSummaryCache.set(key, {
    value: summary,
    expiresAt: Date.now() + DASHBOARD_SUMMARY_TTL_MS,
  });
}

export function invalidateCachedDashboardSummary(workspaceId: string) {
  for (const key of dashboardSummaryCache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) {
      dashboardSummaryCache.delete(key);
    }
  }
}

// ─── Agent configs cache ───────────────────────────────────────────────────────

export function getCachedAgentConfigs(workspaceId: string): AgentConfig[] | null {
  const cached = agentConfigsCache.get(workspaceId);
  if (!isFresh(cached)) {
    if (cached) agentConfigsCache.delete(workspaceId);
    return null;
  }
  return cached!.value;
}

export function setCachedAgentConfigs(workspaceId: string, configs: AgentConfig[]) {
  agentConfigsCache.set(workspaceId, {
    value: configs,
    expiresAt: Date.now() + AGENT_CONFIGS_TTL_MS,
  });
}

export function invalidateCachedAgentConfigs(workspaceId: string) {
  agentConfigsCache.delete(workspaceId);
}

// ─── Workflows cache ───────────────────────────────────────────────────────────

export function getCachedWorkflows(workspaceId: string): Workflow[] | null {
  const cached = workflowsCache.get(workspaceId);
  if (!isFresh(cached)) {
    if (cached) workflowsCache.delete(workspaceId);
    logger.debug("cache miss", { cache: "workflows", workspaceId });
    return null;
  }
  logger.debug("cache hit", { cache: "workflows", workspaceId });
  return cached!.value;
}

export function setCachedWorkflows(workspaceId: string, workflows: Workflow[]) {
  workflowsCache.set(workspaceId, { value: workflows, expiresAt: Date.now() + WORKFLOWS_TTL_MS });
}

export function invalidateCachedWorkflows(workspaceId: string) {
  workflowsCache.delete(workspaceId);
}

// ─── Artifacts cache ───────────────────────────────────────────────────────────

export function getCachedArtifacts(workspaceId: string): Artifact[] | null {
  const cached = artifactsCache.get(workspaceId);
  if (!isFresh(cached)) {
    if (cached) artifactsCache.delete(workspaceId);
    logger.debug("cache miss", { cache: "artifacts", workspaceId });
    return null;
  }
  logger.debug("cache hit", { cache: "artifacts", workspaceId });
  return cached!.value;
}

export function setCachedArtifacts(workspaceId: string, artifacts: Artifact[]) {
  artifactsCache.set(workspaceId, { value: artifacts, expiresAt: Date.now() + ARTIFACTS_TTL_MS });
}

export function invalidateCachedArtifacts(workspaceId: string) {
  artifactsCache.delete(workspaceId);
}

// ─── Approvals cache ───────────────────────────────────────────────────────────

export function getCachedApprovals(workspaceId: string): Approval[] | null {
  const cached = approvalsCache.get(workspaceId);
  if (!isFresh(cached)) {
    if (cached) approvalsCache.delete(workspaceId);
    logger.debug("cache miss", { cache: "approvals", workspaceId });
    return null;
  }
  logger.debug("cache hit", { cache: "approvals", workspaceId });
  return cached!.value;
}

export function setCachedApprovals(workspaceId: string, approvals: Approval[]) {
  approvalsCache.set(workspaceId, { value: approvals, expiresAt: Date.now() + APPROVALS_TTL_MS });
}

export function invalidateCachedApprovals(workspaceId: string) {
  approvalsCache.delete(workspaceId);
}

// ─── Command sessions cache ────────────────────────────────────────────────────

export function getCachedCommandSessions(workspaceId: string): CommandSession[] | null {
  const cached = commandSessionsCache.get(workspaceId);
  if (!isFresh(cached)) {
    if (cached) commandSessionsCache.delete(workspaceId);
    logger.debug("cache miss", { cache: "commandSessions", workspaceId });
    return null;
  }
  logger.debug("cache hit", { cache: "commandSessions", workspaceId });
  return cached!.value;
}

export function setCachedCommandSessions(workspaceId: string, sessions: CommandSession[]) {
  commandSessionsCache.set(workspaceId, { value: sessions, expiresAt: Date.now() + COMMAND_SESSIONS_TTL_MS });
}

export function invalidateCachedCommandSessions(workspaceId: string) {
  commandSessionsCache.delete(workspaceId);
}

// ─── Memory cache ──────────────────────────────────────────────────────────────

export function getCachedMemory(workspaceId: string): MemoryNode[] | null {
  const cached = memoryCache.get(workspaceId);
  if (!isFresh(cached)) {
    if (cached) memoryCache.delete(workspaceId);
    logger.debug("cache miss", { cache: "memory", workspaceId });
    return null;
  }
  logger.debug("cache hit", { cache: "memory", workspaceId });
  return cached!.value;
}

export function setCachedMemory(workspaceId: string, nodes: MemoryNode[]) {
  memoryCache.set(workspaceId, { value: nodes, expiresAt: Date.now() + MEMORY_TTL_MS });
}

export function invalidateCachedMemory(workspaceId: string) {
  memoryCache.delete(workspaceId);
}

// ─── Integrations count cache ──────────────────────────────────────────────────
// Caches the number of active integrations per workspace to avoid a full
// collection scan in assertIntegrationLimit on every connection attempt.

export function getCachedIntegrationsCount(workspaceId: string): number | null {
  const cached = integrationsCountCache.get(workspaceId);
  if (!isFresh(cached)) {
    if (cached) integrationsCountCache.delete(workspaceId);
    return null;
  }
  return cached!.value;
}

export function setCachedIntegrationsCount(workspaceId: string, count: number) {
  integrationsCountCache.set(workspaceId, {
    value: count,
    expiresAt: Date.now() + INTEGRATIONS_COUNT_TTL_MS,
  });
}

export function invalidateCachedIntegrationsCount(workspaceId: string) {
  integrationsCountCache.delete(workspaceId);
}

// ─── Global invalidation ───────────────────────────────────────────────────────

export function invalidateRequestStateCaches(userId: string) {
  invalidateCachedUser(userId);
  invalidateCachedCurrentWorkspace(userId);
}
