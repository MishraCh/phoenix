"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components/ui/ToastProvider";
import { useAuth } from "@/hooks/useAuth";
import {
  gideonQueryKeys,
  useAgentsQuery,
  useCommandSessionsQuery,
  useDashboardSummaryQuery,
  useOnboardingQuery,
  useWorkspaceDetailQuery,
} from "@/hooks/useGideonQueries";
import { useWorkspace } from "@/hooks/useWorkspace";
import { fallbackAgents } from "@/services/agents";
import { createLocalCommandPreview, submitCommand, type CommandMode, type CommandResponse } from "@/services/command";
import { approveApproval, retryApproval } from "@/services/approvals";
import {
  backendMessagesToSessionMessages,
  createArtifactFromCommandSessionMessage,
  fetchCommandSession,
  saveCommandSessionMessage,
  starCommandSessionMessage,
  unstarCommandSessionMessage,
  updateCommandSession,
} from "@/services/commandSessions";
import { emptyDashboardSummary } from "@/services/dashboard";
import { getFriendlyErrorMessage } from "@/lib/product";

import { useWorkspaceStream } from "@/hooks/useWorkspaceStream";
import {
  clearActiveIntegrationContext,
  type ActiveIntegrationContext,
  readActiveIntegrationContext,
  subscribeToActiveIntegrationContext,
} from "@/lib/activeIntegrationContext";
import { cn } from "@/lib/utils";

import { PageErrorBoundary } from "@/components/ui/PageErrorBoundary";
import { useRunningStatusContext } from "@/components/app-shell/RunningStatusProvider";
import { IdleView } from "./command-center/IdleView";
import { SessionView } from "./command-center/SessionView";
import { statusCopyForMode, type SessionMessage } from "./command-center/types";
import { Brain, X } from "lucide-react";
import Link from "next/link";

const COMMAND_PROGRESS_EVENTS = [
  "command.context_loaded",
  "command.tool_started",
  "command.tool_completed",
  "command.planning",
  "command.synthesizing",
  "command.token",
];

const SSE_STATUS_COPY: Record<string, string> = {
  "command.context_loaded": "Loading your workspace context…",
  "command.tool_started": "Running search & research…",
  "command.tool_completed": "Processing results…",
  "command.planning": "Planning response…",
  "command.synthesizing": "Writing response…",
};

function deriveArtifactTitleFromResponse(response: CommandResponse | null) {
  if (!response) return null;

  const result = response.result;
  if (result) {
    if ("summary" in result && typeof result.summary === "string" && result.summary.trim()) {
      return result.summary.trim().slice(0, 120);
    }

    if (result.kind === "expert" && result.expertType === "pre_call_brief") {
      return result.payload.objective.trim().slice(0, 120);
    }

    if (result.kind === "extract_url") {
      return result.page.title?.trim().slice(0, 120) ?? null;
    }

    if (result.kind === "workflow") {
      return result.workflow?.name?.trim().slice(0, 120) ?? null;
    }
  }

  return response.answer?.trim().slice(0, 120) || null;
}

export function CommandCenterPage() {
  const { pushToast } = useToast();
  const { dismiss } = useRunningStatusContext();
  const { idToken } = useAuth();
  const { me, workspaces } = useWorkspace();
  const workspaceId = me?.defaultWorkspaceId ?? workspaces[0]?.id ?? null;

  const [setupProgress, setSetupProgress] = useState(0);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [restoringSession, setRestoringSession] = useState(false);
  const [selectedMode, setSelectedMode] = useState<Exclude<CommandMode, "auto"> | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [activeIntegrationContext, setActiveIntegrationContext] = useState(() => readActiveIntegrationContext());
  const [identityBannerDismissed, setIdentityBannerDismissed] = useState(() => {
    try { return typeof window !== "undefined" && Boolean(sessionStorage.getItem("gideon:identity-banner-dismissed")); }
    catch { return false; }
  });

  const workspaceDetailQuery = useWorkspaceDetailQuery(workspaceId);
  const profileIsEmpty = workspaceDetailQuery.data
    ? !workspaceDetailQuery.data.profile ||
      !Object.values(workspaceDetailQuery.data.profile).some((v) => typeof v === "string" ? v.trim().length > 0 : Boolean(v))
    : false;
  const showIdentityBanner = profileIsEmpty && !identityBannerDismissed;

  function dismissIdentityBanner() {
    setIdentityBannerDismissed(true);
    try { sessionStorage.setItem("gideon:identity-banner-dismissed", "1"); } catch {}
  }

  const queryClient = useQueryClient();
  const summaryQuery = useDashboardSummaryQuery();
  const agentsQuery = useAgentsQuery();
  const sessionsQuery = useCommandSessionsQuery();
  const summary = summaryQuery.data ?? emptyDashboardSummary;
  const availableAgents = (() => {
    const fetchedAgents = agentsQuery.data?.agents ?? [];
    if (!fetchedAgents.length) {
      return fallbackAgents;
    }

    const fetchedMap = new Map(fetchedAgents.map((agent) => [agent.id, agent]));
    const merged = fallbackAgents.map((agent) => ({
      ...agent,
      ...(fetchedMap.get(agent.id) ?? {}),
    }));

    fetchedAgents.forEach((agent) => {
      if (!merged.some((existing) => existing.id === agent.id)) {
        merged.push(agent);
      }
    });

    return merged;
  })();
  const onboardingQuery = useOnboardingQuery(workspaceId);
  const loadingSummary = summaryQuery.isLoading && !summaryQuery.data;
  const summaryError = summaryQuery.error
    ? getFriendlyErrorMessage(summaryQuery.error, "We couldn't load the latest workspace summary.")
    : null;

  const sessionActive = messages.length > 0 || restoringSession;

  // Restore session linked from the Running dropdown (?session=<sessionId>)
  const urlSessionRestoredRef = useRef(false);
  useEffect(() => {
    if (urlSessionRestoredRef.current) return;
    const sessionId =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("session") : null;
    if (sessionId) {
      urlSessionRestoredRef.current = true;
      void handleContinueSession(sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useWorkspaceStream(
    COMMAND_PROGRESS_EVENTS,
    useCallback((event: string, data: unknown) => {
      if (event === "command.token") {
        const token = (data as { token?: string } | null)?.token ?? "";
        if (!token) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.status === "running"
              ? { ...m, streamingText: (m.streamingText ?? "") + token, statusCopy: "Writing response…" }
              : m,
          ),
        );
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.status === "running" ? { ...m, statusCopy: SSE_STATUS_COPY[event] ?? m.statusCopy } : m,
        ),
      );
    }, []),
  );

  useEffect(() => {
    if (selectedAgentId && !availableAgents.some((a) => a.id === selectedAgentId)) {
      setSelectedAgentId(null);
    }
  }, [availableAgents, selectedAgentId]);

  useEffect(() => subscribeToActiveIntegrationContext(() => setActiveIntegrationContext(readActiveIntegrationContext())), []);

  useEffect(() => {
    const onboarding = onboardingQuery.data?.onboarding;

    if (onboarding) {
      setSetupProgress(onboarding.completed ? 100 : Math.min(95, ((onboarding.currentStep ?? 0) + 1) * 11));
      return;
    }

    const rawState =
      (workspaceId ? window.localStorage.getItem(`gideon:onboarding:draft:${workspaceId}`) : null) ??
      window.localStorage.getItem("gideon:onboarding");

    if (!rawState) {
      setSetupProgress(18);
      return;
    }

    try {
      const parsed = JSON.parse(rawState) as { currentStep?: number; completed?: boolean };
      setSetupProgress(parsed.completed ? 100 : Math.min(95, ((parsed.currentStep ?? 0) + 1) * 11));
    } catch {
      setSetupProgress(18);
    }
  }, [onboardingQuery.data?.onboarding, workspaceId]);

  async function handleSubmit(userQuery: string, mode: CommandMode, agentId: string | null) {
    const inheritedAgent = [...messages].reverse().find((message) => message.agentId || message.agentName) ?? null;
    const effectiveAgentId = agentId ?? inheritedAgent?.agentId ?? null;
    const msgId = crypto.randomUUID();
    const agentName =
      availableAgents.find((a) => a.id === effectiveAgentId)?.name ??
      (effectiveAgentId === inheritedAgent?.agentId ? inheritedAgent?.agentName : null) ??
      null;

    const newMsg: SessionMessage = {
      id: msgId,
      assistantMessageId: null,
      userQuery,
      mode,
      agentId: effectiveAgentId,
      agentName,
      status: "running",
      response: null,
      statusCopy: idToken ? statusCopyForMode(mode) : "Preparing a guided sample.",
      starred: false,
      savedItemId: null,
    };

    setMessages((prev) => [...prev, newMsg]);
    setCommand("");
    if (mode !== "auto") {
      setSelectedMode(null);
    }

    if (!idToken) {
      const preview = createLocalCommandPreview(userQuery);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                status: "completed" as const,
                response: preview,
                statusCopy: "Sign in to run this with live workspace context.",
                assistantMessageId: preview.assistantMessageId ?? null,
              }
            : m,
        ),
      );
      return;
    }

    try {
      const response = await submitCommand({
        firebaseIdToken: idToken,
        command: userQuery,
        mode,
        agentId: effectiveAgentId,
        contextBundleId: activeIntegrationContext?.contextBundleId ?? null,
        attachments: [],
        sessionId: activeSessionId ?? undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        clientCommandId: msgId,
      });
      setActiveSessionId(response.sessionId);
      void queryClient.invalidateQueries({ queryKey: gideonQueryKeys.commandSessions(idToken) });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                assistantMessageId: response.assistantMessageId ?? null,
                mode: response.resolvedMode ?? m.mode,
                status: "completed" as const,
                response,
                statusCopy: "Response ready.",
              }
            : m,
        ),
      );
      if (response.createdApproval) {
        void queryClient.invalidateQueries({ queryKey: gideonQueryKeys.approvals(idToken) });
        void queryClient.invalidateQueries({ queryKey: gideonQueryKeys.dashboardSummary(idToken) });
      }
      
      if (response.commandId) {
        dismiss(response.commandId);
      }
    } catch (error) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                status: "error" as const,
                response: createLocalCommandPreview(userQuery),
                statusCopy: getFriendlyErrorMessage(error, "We couldn't finish that request yet."),
              }
            : m,
        ),
      );
      pushToast({
        title: "Request needs attention",
        description: getFriendlyErrorMessage(error, "Try again in a moment."),
        tone: "error",
      });
    }
  }

  async function handleApproveApproval(messageId: string, approvalId: string, options?: { retry?: boolean }) {
    if (!idToken) return;

    // Find the approval's actionType before we execute, so we can show the right toast
    const message = messages.find((m) => m.id === messageId);
    const actionType = message?.response?.createdApproval?.actionType ?? "";

    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId && message.response?.createdApproval
          ? {
              ...message,
              response: {
                ...message.response,
                createdApproval: {
                  ...message.response.createdApproval,
                  status: "executing" as const,
                },
              },
            }
          : message,
      ),
    );

    // Derive human-readable action label from actionType
    function approvalLabel(type: string): { done: string; doing: string; failed: string } {
      if (/gmail|email/i.test(type)) {
        return { done: "Email sent", doing: "Email is sending", failed: "Send failed" };
      }
      if (/hubspot.*update|crm.*update/i.test(type)) {
        return { done: "CRM record updated", doing: "Updating CRM record…", failed: "CRM update failed" };
      }
      if (/hubspot.*create|crm.*create/i.test(type)) {
        return { done: "CRM record created", doing: "Creating CRM record…", failed: "CRM creation failed" };
      }
      if (/hubspot.*note|crm.*note/i.test(type)) {
        return { done: "Note added", doing: "Adding note…", failed: "Note creation failed" };
      }
      if (/hubspot.*task|crm.*task/i.test(type)) {
        return { done: "Task created", doing: "Creating task…", failed: "Task creation failed" };
      }
      if (/hubspot.*association/i.test(type)) {
        return { done: "Association updated", doing: "Updating association…", failed: "Association update failed" };
      }
      return { done: "Action executed", doing: "Executing action…", failed: "Action failed" };
    }

    const label = approvalLabel(actionType);

    try {
      const result = options?.retry
        ? await retryApproval(idToken, approvalId)
        : await approveApproval(idToken, approvalId);

      const nextStatus =
        result.status === "approved"
          ? "pending"
          : result.status === "executed"
            ? "executed"
            : result.status === "executing"
              ? "executing"
              : "failed";

      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId && message.response?.createdApproval
            ? {
                ...message,
                response: {
                  ...message.response,
                  createdApproval: {
                    ...message.response.createdApproval,
                    status: nextStatus,
                  },
                },
              }
            : message,
        ),
      );

      void queryClient.invalidateQueries({ queryKey: gideonQueryKeys.approvals(idToken) });
      void queryClient.invalidateQueries({ queryKey: gideonQueryKeys.dashboardSummary(idToken) });

      if (result.status === "executed") {
        pushToast({
          title: label.done,
          description: "The approved action executed successfully.",
          tone: "success",
        });
      } else if (result.status === "executing") {
        pushToast({
          title: label.doing,
          description: "The approval was accepted and the action is executing now.",
          tone: "default",
        });
      } else if (result.status === "failed") {
        pushToast({
          title: label.failed,
          description: result.error ?? "The approved action could not be completed.",
          tone: "error",
        });
      }
    } catch (error) {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId && message.response?.createdApproval
            ? {
                ...message,
                response: {
                  ...message.response,
                  createdApproval: {
                    ...message.response.createdApproval,
                    status: "failed" as const,
                  },
                },
              }
            : message,
        ),
      );
      pushToast({
        title: label.failed,
        description: getFriendlyErrorMessage(error, "We couldn't complete that approval."),
        tone: "error",
      });
    }
  }

  async function handleToggleStar(messageId: string, assistantMessageId: string, starred: boolean) {
    if (!idToken || !activeSessionId) return;

    try {
      const result = starred
        ? await unstarCommandSessionMessage(idToken, activeSessionId, assistantMessageId)
        : await starCommandSessionMessage(idToken, activeSessionId, assistantMessageId);

      setMessages((prev) =>
        prev.map((message) => (message.id === messageId ? { ...message, starred: result.starred } : message)),
      );
    } catch (error) {
      pushToast({
        title: "Bookmark needs attention",
        description: getFriendlyErrorMessage(error, "We couldn't update that bookmark yet."),
        tone: "error",
      });
    }
  }

  async function handleSaveResponse(messageId: string, assistantMessageId: string) {
    if (!idToken || !activeSessionId) return;

    try {
      const result = await saveCommandSessionMessage(idToken, activeSessionId, assistantMessageId);
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId ? { ...message, savedItemId: result.savedItem.id } : message,
        ),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: gideonQueryKeys.savedItems(idToken) }),
        queryClient.invalidateQueries({ queryKey: gideonQueryKeys.commandSessions(idToken) }),
      ]);
      pushToast({
        title: "Saved to library",
        description: "This response is now available in Saved Responses.",
        tone: "success",
      });
    } catch (error) {
      pushToast({
        title: "Save needs attention",
        description: getFriendlyErrorMessage(error, "We couldn't save that response yet."),
        tone: "error",
      });
    }
  }

  async function handleCreateArtifact(
    messageId: string,
    assistantMessageId: string,
    input: { title?: string; artifactType: "report" | "draft" | "summary" | "data" | "document" },
  ) {
    if (!idToken || !activeSessionId) return;

    try {
      const result = await createArtifactFromCommandSessionMessage(idToken, activeSessionId, assistantMessageId, input);
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId && message.response
            ? {
                ...message,
                response: {
                  ...message.response,
                  createdArtifact: {
                    artifactId: result.artifactId,
                    title: input.title?.trim() || deriveArtifactTitleFromResponse(message.response) || "Saved artifact",
                    artifactType: input.artifactType,
                    previewText: (message.response.answer ?? "").slice(0, 280),
                  },
                },
              }
            : message,
        ),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: gideonQueryKeys.artifacts(idToken) }),
        queryClient.invalidateQueries({ queryKey: gideonQueryKeys.savedItems(idToken) }),
        queryClient.invalidateQueries({ queryKey: gideonQueryKeys.commandSessions(idToken) }),
      ]);
      pushToast({
        title: "Artifact created",
        description: "The response has been promoted into your library.",
        tone: "success",
      });
    } catch (error) {
      pushToast({
        title: "Artifact creation needs attention",
        description: getFriendlyErrorMessage(error, "We couldn't create that artifact yet."),
        tone: "error",
      });
    }
  }

  function handleNewSession() {
    setMessages([]);
    setActiveSessionId(null);
    setSelectedMode(null);
    setSelectedAgentId(null);
    setCommand("");
  }

  async function handleContinueSession(sessionId: string) {
    setActiveSessionId(sessionId);
    setRestoringSession(true);
    if (!idToken) {
      setRestoringSession(false);
      return;
    }
    try {
      const detail = await fetchCommandSession(idToken, sessionId);
      const restoredMessages = backendMessagesToSessionMessages(detail.messages, me?.id ?? null);
      setMessages(restoredMessages);
      const latestAgentId = [...restoredMessages].reverse().find((message) => message.agentId)?.agentId ?? null;
      if (latestAgentId) {
        setSelectedAgentId(latestAgentId);
      }
    } catch (err) {
      pushToast({
        title: "Couldn't load session",
        description: getFriendlyErrorMessage(err, "The session history couldn't be restored. You can still continue the conversation."),
        tone: "error",
      });
    } finally {
      setRestoringSession(false);
    }
  }

  function handleSelectMode(mode: Exclude<CommandMode, "auto"> | null) {
    setSelectedMode(mode);
  }

  function handleSelectAgent(id: string | null) {
    setSelectedAgentId(id);
  }

  async function handleDeleteSession(sessionId: string) {
    if (!idToken) return;
    try {
      await updateCommandSession(idToken, sessionId, { status: "archived" });
      void queryClient.invalidateQueries({ queryKey: gideonQueryKeys.commandSessions(idToken) });
      pushToast({ title: "Session deleted", tone: "default" });
    } catch (err) {
      pushToast({
        title: "Couldn't delete session",
        description: getFriendlyErrorMessage(err, "Please try again later."),
        tone: "error",
      });
    }
  }

  async function handleRenameSession(sessionId: string, currentTitle: string) {
    if (!idToken) return;
    const newTitle = window.prompt("Rename session:", currentTitle);
    if (!newTitle || newTitle.trim() === "" || newTitle === currentTitle) return;

    try {
      await updateCommandSession(idToken, sessionId, { title: newTitle.trim() });
      void queryClient.invalidateQueries({ queryKey: gideonQueryKeys.commandSessions(idToken) });
      pushToast({ title: "Session renamed", tone: "success" });
    } catch (err) {
      pushToast({
        title: "Couldn't rename session",
        description: getFriendlyErrorMessage(err, "Please try again later."),
        tone: "error",
      });
    }
  }

  return (
    <section className={cn("flex w-full min-w-0 flex-col", sessionActive ? "h-full overflow-hidden" : "overflow-x-hidden pb-12")}>
      {/* ── Identity setup banner ──────────────────────────────────────── */}
      {showIdentityBanner && (
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-2.5">
          <Brain className="size-4 shrink-0 text-primary" />
          <p className="flex-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Gideon doesn't know much about your business yet.</span>{" "}
            <Link
              href="/settings"
              className="text-primary underline underline-offset-2 hover:no-underline"
              onClick={dismissIdentityBanner}
            >
              Set up AI context
            </Link>{" "}
            to get personalized battlecards, outreach drafts, and expert analysis.
          </p>
          <button
            type="button"
            onClick={dismissIdentityBanner}
            className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <div className={cn("min-h-0", sessionActive ? "flex-1" : "")}>
        <AnimatePresence mode="wait">
          {!sessionActive ? (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              <IdleView
                command={command}
                onCommandChange={setCommand}
                selectedMode={selectedMode}
                selectedAgentId={selectedAgentId}
                availableAgents={availableAgents}
                activeIntegrationContext={activeIntegrationContext}
                onClearIntegrationContext={() => {
                  clearActiveIntegrationContext();
                  setActiveIntegrationContext(null);
                }}
                onSelectMode={handleSelectMode}
                onSelectAgent={handleSelectAgent}
                onSubmit={handleSubmit}
                summary={summary}
                loadingSummary={loadingSummary}
                summaryError={summaryError}
                setupProgress={setupProgress}
                onRefreshSummary={() => void summaryQuery.refetch()}
                recentSessions={sessionsQuery.data?.sessions ?? []}
                onContinueSession={(id) => void handleContinueSession(id)}
                onDeleteSession={(id) => void handleDeleteSession(id)}
                onRenameSession={(id, currentTitle) => void handleRenameSession(id, currentTitle)}
              />
            </motion.div>
          ) : (
            <motion.div
              key="session"
              className="h-full min-h-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              <PageErrorBoundary fallbackLabel="The chat session encountered an error.">
                <SessionView
                  messages={messages}
                  availableAgents={availableAgents}
                  selectedMode={selectedMode}
                  selectedAgentId={selectedAgentId}
                  activeIntegrationContext={activeIntegrationContext}
                  onClearIntegrationContext={() => {
                    clearActiveIntegrationContext();
                    setActiveIntegrationContext(null);
                  }}
                  onSelectMode={handleSelectMode}
                  onSelectAgent={handleSelectAgent}
                  onSubmit={handleSubmit}
                  onApproveApproval={handleApproveApproval}
                  onToggleStar={handleToggleStar}
                  onSaveResponse={handleSaveResponse}
                  onCreateArtifact={handleCreateArtifact}
                  onNewSession={handleNewSession}
                  loadingMessages={restoringSession}
                />
              </PageErrorBoundary>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
