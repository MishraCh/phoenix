"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAuth } from "@/hooks/useAuth";
import { FullscreenLoader } from "@/components/ui/FullscreenLoader";
import { gideonQueryKeys } from "@/hooks/useGideonQueries";
import { WorkspaceContext } from "@/hooks/useWorkspace";
import { getFriendlyErrorMessage, getDefaultWorkspaceName } from "@/lib/product";
import { bootstrapSession, seedBootstrapCaches, type AuthBootstrapResponse } from "@/services/authSetup";
import {
  createWorkspace as createWorkspaceRequest,
  joinWorkspace as joinWorkspaceRequest,
  selectWorkspace as selectWorkspaceRequest,
  type WorkspaceListItem,
} from "@/services/workspaces";

const storageKey = "gideon:selectedWorkspaceId";

type WorkspaceProviderProps = {
  children: ReactNode;
};

function getStoredSelectedWorkspaceId() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(storageKey);
}

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  const { idToken, user } = useAuth();
  const queryClient = useQueryClient();
  const [me, setMe] = useState<AuthBootstrapResponse["user"] | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceIdState] = useState<string | null>(null);
  const [selectingWorkspaceId, setSelectingWorkspaceId] = useState<string | null>(null);
  // Tracks the bootstrap key currently in-flight or last completed, preventing duplicate calls
  // on React StrictMode double-invoke or concurrent renders with the same token+workspace.
  const bootstrapKeyRef = useRef<string | null>(null);

  const applyBootstrapPayload = useCallback(
    (payload: AuthBootstrapResponse) => {
      setMe(payload.user);
      setWorkspaces(payload.workspaces);
      seedBootstrapCaches(queryClient, idToken!, payload);

      const locallySelectedWorkspaceId = getStoredSelectedWorkspaceId();
      const nextSelectedWorkspace =
        payload.workspaces.find((workspace) => workspace.id === selectingWorkspaceId) ??
        payload.workspaces.find((workspace) => workspace.id === payload.user.defaultWorkspaceId) ??
        payload.workspaces.find((workspace) => workspace.id === locallySelectedWorkspaceId) ??
        payload.workspaces[0] ??
        null;

      setSelectedWorkspaceIdState(nextSelectedWorkspace?.id ?? null);

      if (typeof window !== "undefined") {
        if (nextSelectedWorkspace?.id) {
          window.localStorage.setItem(storageKey, nextSelectedWorkspace.id);
        } else {
          window.localStorage.removeItem(storageKey);
        }
      }
    },
    [idToken, queryClient, selectingWorkspaceId],
  );

  const runBootstrap = useCallback(
    async (nextToken: string) => {
      const payload = await bootstrapSession(nextToken);
      applyBootstrapPayload(payload);
      setError(null);
      return payload;
    },
    [applyBootstrapPayload],
  );

  useEffect(() => {
    if (!idToken) {
      setMe(null);
      setWorkspaces([]);
      setSelectedWorkspaceIdState(null);
      setSelectingWorkspaceId(null);
      setError(null);
      setLoading(false);
      bootstrapKeyRef.current = null;
      return;
    }

    const cachedMe = queryClient.getQueryData<{ user: AuthBootstrapResponse["user"] }>(
      gideonQueryKeys.authMe(idToken),
    );
    const cachedWorkspaces = queryClient.getQueryData<{ workspaces: WorkspaceListItem[] }>(
      gideonQueryKeys.workspaces(idToken),
    );

    if (cachedMe?.user && cachedWorkspaces?.workspaces?.length) {
      setMe(cachedMe.user);
      setWorkspaces(cachedWorkspaces.workspaces);

      const locallySelectedWorkspaceId = getStoredSelectedWorkspaceId();
      const nextSelectedWorkspace =
        cachedWorkspaces.workspaces.find((workspace) => workspace.id === selectingWorkspaceId) ??
        cachedWorkspaces.workspaces.find((workspace) => workspace.id === cachedMe.user.defaultWorkspaceId) ??
        cachedWorkspaces.workspaces.find((workspace) => workspace.id === locallySelectedWorkspaceId) ??
        cachedWorkspaces.workspaces[0] ??
        null;

      setSelectedWorkspaceIdState(nextSelectedWorkspace?.id ?? null);
      setLoading(false);
      return;
    }

    // Deduplicate by user UID (stable across token refreshes) + selecting workspace
    const bootstrapKey = `${user?.uid ?? idToken}:${selectingWorkspaceId ?? "none"}`;
    if (bootstrapKeyRef.current === bootstrapKey) return;
    bootstrapKeyRef.current = bootstrapKey;

    setLoading(true);
    void runBootstrap(idToken)
      .catch((nextError) => {
        bootstrapKeyRef.current = null; // allow retry on error
        setError(getFriendlyErrorMessage(nextError, "We couldn't load your workspace list yet."));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [idToken, queryClient, runBootstrap, selectingWorkspaceId]);

  const refresh = useCallback(async () => {
    if (!idToken) {
      setMe(null);
      setWorkspaces([]);
      setSelectedWorkspaceIdState(null);
      setSelectingWorkspaceId(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      await runBootstrap(idToken);
    } finally {
      setLoading(false);
    }
  }, [idToken, runBootstrap]);

  const selectWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!idToken) {
        throw new Error("Sign in before switching workspaces.");
      }

      if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
        throw new Error("That workspace is no longer available.");
      }

      const previousSelectedWorkspaceId = selectedWorkspaceId;
      setSelectingWorkspaceId(workspaceId);
      setSelectedWorkspaceIdState(workspaceId);

      try {
        const result = await selectWorkspaceRequest(idToken, workspaceId);

        if (typeof window !== "undefined") {
          window.localStorage.setItem(storageKey, result.defaultWorkspaceId);
        }

        await runBootstrap(idToken);
      } catch (nextError) {
        setSelectedWorkspaceIdState(previousSelectedWorkspaceId);

        if (typeof window !== "undefined") {
          if (previousSelectedWorkspaceId) {
            window.localStorage.setItem(storageKey, previousSelectedWorkspaceId);
          } else {
            window.localStorage.removeItem(storageKey);
          }
        }

        throw new Error(getFriendlyErrorMessage(nextError, "We couldn't switch workspaces yet."));
      } finally {
        setSelectingWorkspaceId(null);
      }
    },
    [idToken, runBootstrap, selectedWorkspaceId, workspaces],
  );

  const createWorkspace = useCallback(
    async (name?: string) => {
      if (!idToken) {
        throw new Error("Sign in before creating a workspace.");
      }

      const workspaceName =
        name?.trim() || getDefaultWorkspaceName(me?.displayName ?? user?.displayName, me?.email ?? user?.email);

      try {
        const result = await createWorkspaceRequest(idToken, workspaceName);

        if (typeof window !== "undefined") {
          window.localStorage.setItem(storageKey, result.workspaceId);
        }

        await runBootstrap(idToken);
      } catch (nextError) {
        throw new Error(getFriendlyErrorMessage(nextError, "We couldn't create that workspace yet."));
      }
    },
    [idToken, me?.displayName, me?.email, runBootstrap, user?.displayName, user?.email],
  );

  const joinWorkspace = useCallback(
    async (input: { workspaceId: string; inviteCode: string }) => {
      if (!idToken) {
        throw new Error("Sign in before joining a workspace.");
      }

      try {
        const result = await joinWorkspaceRequest(idToken, input);

        if (typeof window !== "undefined") {
          window.localStorage.setItem(storageKey, result.defaultWorkspaceId);
        }

        await runBootstrap(idToken);
      } catch (nextError) {
        throw new Error(getFriendlyErrorMessage(nextError, "We couldn't join that workspace yet."));
      }
    },
    [idToken, runBootstrap],
  );

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );

  const value = useMemo(
    () => ({
      me,
      workspaces,
      selectedWorkspaceId,
      selectedWorkspace,
      loading,
      error,
      selectingWorkspaceId,
      selectWorkspace,
      createWorkspace,
      joinWorkspace,
      refresh,
    }),
    [
      createWorkspace,
      error,
      joinWorkspace,
      loading,
      me,
      refresh,
      selectWorkspace,
      selectedWorkspace,
      selectedWorkspaceId,
      selectingWorkspaceId,
      workspaces,
    ],
  );

  if (idToken && loading && !me) {
    return (
      <WorkspaceContext.Provider value={value}>
        <FullscreenLoader
          title="Preparing your workspace"
          description="Loading workspace, agents, and saved context…"
          steps={[
            "Loading workspace…",
            "Fetching your agents…",
            "Restoring context…",
            "Loading saved work…",
            "Almost ready…",
          ]}
        />
      </WorkspaceContext.Provider>
    );
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
