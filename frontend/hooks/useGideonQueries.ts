"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { fetchActivity } from "@/services/activity";
import { fetchAgents } from "@/services/agents";
import { fetchApproval, fetchApprovals } from "@/services/approvals";
import { fetchArtifact, fetchArtifacts } from "@/services/artifacts";
import { fetchAuthMe } from "@/services/auth";
import { fetchCommandSessions, fetchCommandSession } from "@/services/commandSessions";
import { fetchContextBundles } from "@/services/context";
import { fetchDashboardSummary } from "@/services/dashboard";
import {
  fetchGmailStyleProfile,
  fetchIntegrationDetail,
  fetchIntegrationItemDetail,
  fetchIntegrations,
  fetchIntegrationWorkspace,
} from "@/services/integrations";
import { fetchNotifications } from "@/services/notifications";
import { fetchOnboardingProgress } from "@/services/onboarding";
import { fetchMemory } from "@/services/memory";
import { fetchSavedItem, fetchSavedItems } from "@/services/savedItems";
import { fetchWorkflow, fetchWorkflows, fetchWorkflowRuns } from "@/services/workflows";
import { fetchWorkspace, fetchWorkspaces } from "@/services/workspaces";

const staleTimes = {
  commandSessions: 60 * 1000,
  authMe: 10 * 60 * 1000,
  workspaces: 10 * 60 * 1000,
  notifications: 45 * 1000,
  dashboardSummary: 3 * 60 * 1000,
  agents: 15 * 60 * 1000,
  workflows: 10 * 60 * 1000,
  workflowRuns: 30 * 1000,
  approvals: 3 * 60 * 1000,
  artifacts: 10 * 60 * 1000,
  savedItems: 5 * 60 * 1000,
  activity: 3 * 60 * 1000,
  integrations: 15 * 60 * 1000,
  context: 5 * 60 * 1000,
  memory: 60 * 1000,
  workspaceDetail: 10 * 60 * 1000,
  onboarding: 10 * 60 * 1000,
} as const;

function decodeJwtPayload(token: string) {
  try {
    const payload = token.split(".")[1];

    if (!payload) {
      return null;
    }

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    const atobFn = typeof window !== "undefined" ? window.atob : null;

    if (!atobFn) {
      return null;
    }

    const json = atobFn(padded);

    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getQueryIdentity(identityOrToken: string | null) {
  if (!identityOrToken) {
    return "anonymous";
  }

  const payload = decodeJwtPayload(identityOrToken);
  const derivedIdentity =
    (typeof payload?.user_id === "string" ? payload.user_id : null) ??
    (typeof payload?.sub === "string" ? payload.sub : null);

  return derivedIdentity ?? identityOrToken;
}

export const gideonQueryKeys = {
  commandSessions: (token: string | null) => ["commandSessions", getQueryIdentity(token)] as const,
  channelCommandSessions: (token: string | null, source: string) => ["channelCommandSessions", source, getQueryIdentity(token)] as const,
  commandSession: (token: string | null, sessionId: string) =>
    ["commandSessions", getQueryIdentity(token), sessionId] as const,
  authMe: (token: string | null) => ["auth", "me", getQueryIdentity(token)] as const,
  workspaces: (token: string | null) => ["workspaces", getQueryIdentity(token)] as const,
  notifications: (token: string | null) => ["notifications", getQueryIdentity(token)] as const,
  dashboardSummary: (token: string | null) => ["dashboard", "summary", getQueryIdentity(token)] as const,
  agents: (token: string | null) => ["agents", getQueryIdentity(token)] as const,
  workflows: (token: string | null) => ["workflows", getQueryIdentity(token)] as const,
  workflow: (token: string | null, workflowId: string) =>
    ["workflows", getQueryIdentity(token), workflowId] as const,
  workflowRuns: (token: string | null, workflowId: string) =>
    ["workflowRuns", getQueryIdentity(token), workflowId] as const,
  approvals: (token: string | null) => ["approvals", getQueryIdentity(token)] as const,
  approval: (token: string | null, approvalId: string) =>
    ["approvals", getQueryIdentity(token), approvalId] as const,
  artifacts: (token: string | null) => ["artifacts", getQueryIdentity(token)] as const,
  artifact: (token: string | null, artifactId: string) =>
    ["artifacts", getQueryIdentity(token), artifactId] as const,
  savedItems: (token: string | null) => ["savedItems", getQueryIdentity(token)] as const,
  savedItem: (token: string | null, savedItemId: string) =>
    ["savedItems", getQueryIdentity(token), savedItemId] as const,
  memory: (token: string | null) => ["memory", getQueryIdentity(token)] as const,
  activity: (token: string | null) => ["activity", getQueryIdentity(token)] as const,
  context: (token: string | null) => ["context", getQueryIdentity(token)] as const,
  integrations: (token: string | null) => ["integrations", getQueryIdentity(token)] as const,
  integrationDetail: (token: string | null, provider: string) =>
    ["integrations", getQueryIdentity(token), provider] as const,
  integrationWorkspace: (
    token: string | null,
    provider: string,
    query: string,
    module: string,
  ) => ["integrations", "workspace", getQueryIdentity(token), provider, query, module] as const,
  integrationItem: (
    token: string | null,
    provider: string,
    itemId: string,
    module: string,
  ) => ["integrations", "item", getQueryIdentity(token), provider, itemId, module] as const,
  gmailStyleProfile: (token: string | null) =>
    ["integrations", "gmail", "styleProfile", getQueryIdentity(token)] as const,
  workspaceDetail: (token: string | null, workspaceId: string) =>
    ["workspaces", getQueryIdentity(token), workspaceId] as const,
  onboarding: (token: string | null, workspaceId: string) =>
    ["onboarding", getQueryIdentity(token), workspaceId] as const,
} as const;

function useToken() {
  return useAuth().idToken;
}

export function useAuthMeQuery() {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.authMe(token),
    queryFn: () => fetchAuthMe(token!),
    enabled: Boolean(token),
    staleTime: staleTimes.authMe,
    refetchOnWindowFocus: false,
  });
}

export function useWorkspacesQuery() {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.workspaces(token),
    queryFn: () => fetchWorkspaces(token!),
    enabled: Boolean(token),
    staleTime: staleTimes.workspaces,
    refetchOnWindowFocus: false,
  });
}

export function useNotificationsQuery(options?: { enabled?: boolean }) {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.notifications(token),
    queryFn: () => fetchNotifications(token!),
    enabled: Boolean(token) && (options?.enabled ?? true),
    staleTime: staleTimes.notifications,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

export function useDashboardSummaryQuery(options?: { enabled?: boolean }) {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.dashboardSummary(token),
    queryFn: () => fetchDashboardSummary(token!),
    enabled: Boolean(token) && (options?.enabled ?? true),
    staleTime: staleTimes.dashboardSummary,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

export function useAgentsQuery() {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.agents(token),
    queryFn: () => fetchAgents(token!),
    enabled: Boolean(token),
    staleTime: staleTimes.agents,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowsQuery() {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.workflows(token),
    queryFn: () => fetchWorkflows(token!),
    enabled: Boolean(token),
    staleTime: staleTimes.workflows,
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowDetailQuery(workflowId: string | null) {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.workflow(token, workflowId ?? "none"),
    queryFn: () => fetchWorkflow(token!, workflowId!),
    enabled: Boolean(token && workflowId),
    staleTime: staleTimes.workflows,
    placeholderData: keepPreviousData,
  });
}

export function useApprovalsQuery() {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.approvals(token),
    queryFn: () => fetchApprovals(token!),
    enabled: Boolean(token),
    staleTime: staleTimes.approvals,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

export function useApprovalDetailQuery(approvalId: string) {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.approval(token, approvalId),
    queryFn: () => fetchApproval(token!, approvalId),
    enabled: Boolean(token),
    staleTime: staleTimes.approvals,
    placeholderData: keepPreviousData,
  });
}

export function useArtifactsQuery() {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.artifacts(token),
    queryFn: () => fetchArtifacts(token!),
    enabled: Boolean(token),
    staleTime: staleTimes.artifacts,
    placeholderData: keepPreviousData,
  });
}

export function useArtifactDetailQuery(artifactId: string) {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.artifact(token, artifactId),
    queryFn: () => fetchArtifact(token!, artifactId),
    enabled: Boolean(token),
    staleTime: staleTimes.artifacts,
    placeholderData: keepPreviousData,
  });
}

export function useSavedItemsQuery() {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.savedItems(token),
    queryFn: () => fetchSavedItems(token!),
    enabled: Boolean(token),
    staleTime: staleTimes.savedItems,
    placeholderData: keepPreviousData,
  });
}

export function useSavedItemDetailQuery(savedItemId: string) {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.savedItem(token, savedItemId),
    queryFn: () => fetchSavedItem(token!, savedItemId),
    enabled: Boolean(token),
    staleTime: staleTimes.savedItems,
    placeholderData: keepPreviousData,
  });
}

export function useActivityQuery() {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.activity(token),
    queryFn: () => fetchActivity(token!),
    enabled: Boolean(token),
    staleTime: staleTimes.activity,
    placeholderData: keepPreviousData,
  });
}

export function useContextBundlesQuery() {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.context(token),
    queryFn: () => fetchContextBundles(token!),
    enabled: Boolean(token),
    staleTime: staleTimes.context,
    placeholderData: keepPreviousData,
  });
}

export function useIntegrationsQuery() {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.integrations(token),
    queryFn: () => fetchIntegrations(token!),
    enabled: Boolean(token),
    staleTime: staleTimes.integrations,
    placeholderData: keepPreviousData,
  });
}

export function useIntegrationDetailQuery(provider: string) {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.integrationDetail(token, provider),
    queryFn: () => fetchIntegrationDetail(token!, provider),
    enabled: Boolean(token),
    staleTime: staleTimes.integrations,
    placeholderData: keepPreviousData,
  });
}

export function useIntegrationWorkspaceQuery(
  provider: string,
  options?: {
    query?: string;
    module?: "contacts" | "companies" | "deals" | "notes" | "tasks";
    enabled?: boolean;
  },
) {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.integrationWorkspace(
      token,
      provider,
      options?.query ?? "",
      options?.module ?? "",
    ),
    queryFn: () =>
      fetchIntegrationWorkspace(token!, provider, {
        q: options?.query,
        module: options?.module,
      }),
    enabled: Boolean(token) && (options?.enabled ?? true),
    staleTime: staleTimes.integrations,
    placeholderData: keepPreviousData,
  });
}

export function useIntegrationItemQuery(
  provider: string,
  itemId: string | null,
  options?: {
    module?: "contacts" | "companies" | "deals" | "notes" | "tasks";
    enabled?: boolean;
  },
) {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.integrationItem(
      token,
      provider,
      itemId ?? "none",
      options?.module ?? "",
    ),
    queryFn: () =>
      fetchIntegrationItemDetail(token!, provider, itemId!, {
        module: options?.module,
      }),
    enabled: Boolean(token && itemId) && (options?.enabled ?? true),
    staleTime: staleTimes.integrations,
    placeholderData: keepPreviousData,
  });
}

export function useGmailStyleProfileQuery(options?: { enabled?: boolean }) {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.gmailStyleProfile(token),
    queryFn: () => fetchGmailStyleProfile(token!),
    enabled: Boolean(token) && (options?.enabled ?? true),
    staleTime: staleTimes.integrations,
    placeholderData: keepPreviousData,
  });
}

export function useWorkspaceDetailQuery(workspaceId: string | null) {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.workspaceDetail(token, workspaceId ?? "none"),
    queryFn: () => fetchWorkspace(token!, workspaceId!),
    enabled: Boolean(token && workspaceId),
    staleTime: staleTimes.workspaceDetail,
    placeholderData: keepPreviousData,
  });
}

export function useOnboardingQuery(workspaceId: string | null) {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.onboarding(token, workspaceId ?? "none"),
    queryFn: () => fetchOnboardingProgress(token!, workspaceId!),
    enabled: Boolean(token && workspaceId),
    staleTime: staleTimes.onboarding,
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowRunsQuery(workflowId: string | null, options?: { enabled?: boolean }) {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.workflowRuns(token, workflowId ?? "none"),
    queryFn: () => fetchWorkflowRuns(token!, workflowId!),
    enabled: Boolean(token && workflowId) && (options?.enabled ?? true),
    staleTime: staleTimes.workflowRuns,
    placeholderData: keepPreviousData,
  });
}

export function useCommandSessionsQuery() {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.commandSessions(token),
    queryFn: () => fetchCommandSessions(token!, 20, "web"),
    enabled: Boolean(token),
    staleTime: staleTimes.commandSessions,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

export function useChannelCommandSessionsQuery(source: "email" | "whatsapp") {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.channelCommandSessions(token, source),
    queryFn: () => fetchCommandSessions(token!, 20, source),
    enabled: Boolean(token),
    staleTime: staleTimes.commandSessions,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

export function useCommandSessionQuery(sessionId: string | null) {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.commandSession(token, sessionId ?? "none"),
    queryFn: () => fetchCommandSession(token!, sessionId!),
    enabled: Boolean(token && sessionId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useMemoryQuery() {
  const token = useToken();

  return useQuery({
    queryKey: gideonQueryKeys.memory(token),
    queryFn: () => fetchMemory(token!),
    enabled: Boolean(token),
    staleTime: staleTimes.memory,
    placeholderData: keepPreviousData,
  });
}
