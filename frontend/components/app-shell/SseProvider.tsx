"use client";
import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useSseStream } from "@/hooks/useSseStream";
import { getFirebaseAuth } from "@/lib/firebase";
import { apiBaseUrl } from "@/services/apiClient";

type SseHandler = (event: string, data: unknown) => void;

type SseContextValue = {
  subscribe: (handler: SseHandler) => () => void;
};

const SseContext = createContext<SseContextValue | null>(null);

export function useSseContext() {
  return useContext(SseContext);
}

export function SseProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { me } = useWorkspace();
  const workspaceId = me?.defaultWorkspaceId ?? null;
  const handlersRef = useRef<Set<SseHandler>>(new Set());

  const enabled = Boolean(user && workspaceId);

  // Called on every (re)connect — always fetches a fresh token so stale JWTs don't loop forever
  const getUrl = useCallback(async () => {
    const auth = getFirebaseAuth();
    const currentUser = auth?.currentUser ?? user;
    if (!currentUser || !workspaceId) return "";
    const token = await currentUser.getIdToken();
    return `${apiBaseUrl}/events?token=${encodeURIComponent(token)}`;
  }, [user, workspaceId]);

  const onEvent = useCallback((event: string, data: unknown) => {
    for (const handler of handlersRef.current) {
      handler(event, data);
    }
  }, []);

  useSseStream({ getUrl, onEvent, enabled });

  const subscribe = useCallback((handler: SseHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  return <SseContext.Provider value={{ subscribe }}>{children}</SseContext.Provider>;
}
