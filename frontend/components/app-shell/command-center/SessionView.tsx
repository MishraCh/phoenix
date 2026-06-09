"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, RotateCcw } from "lucide-react";

import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { gideonQueryKeys } from "@/hooks/useGideonQueries";
import { RightDetailDrawer } from "@/components/ui/RightDetailDrawer";
import { SourceChips } from "@/components/ui/SourceChips";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/button";
import type { ActiveIntegrationContext } from "@/lib/activeIntegrationContext";
import type { VisibleAgent } from "@/services/agents";
import type { CommandMode } from "@/services/command";

import { ApprovalEditorModal } from "./ApprovalEditorModal";
import { FollowUpComposer } from "./FollowUpComposer";
import { MessagePanel } from "./MessagePanel";
import { modeLabel } from "./types";
import type { SessionMessage } from "./types";

type SessionViewProps = {
  messages: SessionMessage[];
  availableAgents: VisibleAgent[];
  selectedMode: Exclude<CommandMode, "auto"> | null;
  selectedAgentId: string | null;
  activeIntegrationContext: ActiveIntegrationContext | null;
  onClearIntegrationContext: () => void;
  onSelectMode: (mode: Exclude<CommandMode, "auto"> | null) => void;
  onSelectAgent: (id: string | null) => void;
  onSubmit: (query: string, mode: CommandMode, agentId: string | null) => void;
  onApproveApproval: (messageId: string, approvalId: string, options?: { retry?: boolean }) => void;
  onToggleStar: (messageId: string, assistantMessageId: string, starred: boolean) => void;
  onSaveResponse: (messageId: string, assistantMessageId: string) => void;
  onCreateArtifact: (
    messageId: string,
    assistantMessageId: string,
    input: { title?: string; artifactType: "report" | "draft" | "summary" | "data" | "document" },
  ) => void;
  onNewSession: () => void;
  loadingMessages?: boolean;
};

export function SessionView({
  messages,
  availableAgents,
  selectedMode,
  selectedAgentId,
  activeIntegrationContext,
  onClearIntegrationContext,
  onSelectMode,
  onSelectAgent,
  onSubmit,
  onApproveApproval,
  onToggleStar,
  onSaveResponse,
  onCreateArtifact,
  onNewSession,
  loadingMessages = false,
}: SessionViewProps) {
  const threadRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [editingApprovalId, setEditingApprovalId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { idToken } = useAuth();

  const firstMsg = messages[0];
  const lastMsg = messages[messages.length - 1];
  const sessionAgentName = [...messages].reverse().find((message) => message.agentName)?.agentName ?? null;
  const isRunning = lastMsg?.status === "running";
  const sessionTitle = firstMsg?.userQuery ? firstMsg.userQuery.slice(0, 60) + (firstMsg.userQuery.length > 60 ? "…" : "") : "Session";
  const sessionMode = firstMsg?.mode !== "auto" ? firstMsg?.mode : null;

  const selectedMessage = messages.find((m) => m.id === selectedMessageId) ?? null;

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    if (!userScrolledUpRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  function handleThreadScroll() {
    const el = threadRef.current;
    if (!el) return;
    userScrolledUpRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 100;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent">
      {/* Session header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 bg-[linear-gradient(180deg,rgba(255,255,255,0.9)_0%,rgba(249,249,254,0.92)_100%)] px-4 py-3 backdrop-blur-md">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 rounded-full text-muted-foreground hover:bg-white hover:text-foreground hover:shadow-sm"
          onClick={onNewSession}
          title="Back to home"
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{sessionTitle}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {sessionMode ? (
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
              {modeLabel(sessionMode as Exclude<CommandMode, "auto">)}
            </span>
          ) : null}
          {sessionAgentName ? (
            <span className="rounded-full bg-secondary/80 px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {sessionAgentName}
            </span>
          ) : null}
          {lastMsg ? <StatusPill status={lastMsg.status} /> : null}
          <Button
            variant="ghost"
            size="sm"
            className="ml-1 h-7 shrink-0 gap-1.5 rounded-full px-3 text-xs text-muted-foreground hover:bg-white hover:text-foreground hover:shadow-sm"
            onClick={onNewSession}
          >
            <RotateCcw className="size-3" />
            New session
          </Button>
        </div>
      </div>

      {/* Messages thread — fills available space, scrolls internally */}
      <div className="relative min-h-0 flex-1">
        {/* Top scroll fade */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-gradient-to-b from-background/55 to-transparent" />
        {/* Bottom scroll fade */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-background/90 to-transparent" />

        <div
          ref={threadRef}
          onScroll={handleThreadScroll}
          className="h-full space-y-5 overflow-y-auto px-6 pb-10 pt-8 pr-3 scrollbar-thin scrollbar-thumb-primary/15 scrollbar-track-transparent"
        >
          {loadingMessages && messages.length === 0 ? (
            <div className="space-y-4 px-1 py-4">
              {[0, 1].map((n) => (
                <div key={n} className="space-y-2">
                  <div className="h-3 w-2/5 animate-pulse rounded-full bg-primary/8" />
                  <div className="h-16 w-full animate-pulse rounded-2xl bg-primary/5" />
                </div>
              ))}
              <p className="text-center text-xs text-muted-foreground">Restoring session…</p>
            </div>
          ) : (
          messages.map((msg, idx) => {
              // Look backward for the nearest preceding completed assistant message
              // to determine if it was an expert card — used for accent continuity.
              let prevExpertType: string | null = null;
              if (idx > 0) {
                for (let i = idx - 1; i >= 0; i--) {
                  const prev = messages[i];
                  if (
                    prev.status === "completed" &&
                    prev.response?.result?.kind === "expert"
                  ) {
                    prevExpertType = (prev.response.result as { expertType: string }).expertType;
                    break;
                  }
                  // Stop looking once we hit another user query without an expert result
                  if (prev.status === "completed" && prev.response?.result?.kind !== "expert") {
                    break;
                  }
                }
              }
              return (
                <MessagePanel
                  key={msg.id}
                  message={msg}
                  onOpenDetails={setSelectedMessageId}
                  onApproveApproval={onApproveApproval}
                  onEditApproval={setEditingApprovalId}
                  onToggleStar={onToggleStar}
                  onSaveResponse={onSaveResponse}
                  onCreateArtifact={onCreateArtifact}
                  prevExpertType={prevExpertType}
                />
              );
            })
          )}
          <div className="h-2" />
        </div>
      </div>

      {/* Follow-up composer — anchored at bottom, no sticky needed */}
      <div className="shrink-0 border-t border-border/30 bg-background/92 pt-3 backdrop-blur-sm">
        <FollowUpComposer
          selectedMode={selectedMode}
          selectedAgentId={selectedAgentId}
          activeIntegrationContext={activeIntegrationContext}
          onClearIntegrationContext={onClearIntegrationContext}
          availableAgents={availableAgents}
          isRunning={isRunning}
          onSelectMode={onSelectMode}
          onSelectAgent={onSelectAgent}
          onSubmit={onSubmit}
        />
      </div>

      {/* Sources & details drawer — session-level, one instance */}
      <RightDetailDrawer
        open={selectedMessageId !== null}
        onClose={() => setSelectedMessageId(null)}
        title="Sources & details"
        description="Sources linked to this response, missing context, and run metadata."
      >
        {selectedMessage?.response ? (
          <div className="space-y-6">
            {selectedMessage.response.sources.length > 0 ? (
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Sources</p>
                <SourceChips sources={selectedMessage.response.sources} />
              </div>
            ) : (
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Sources</p>
                <p className="text-sm text-muted-foreground">No sources linked for this response.</p>
              </div>
            )}

            {selectedMessage.response.missingContext.length > 0 ? (
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Context still missing
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedMessage.response.missingContext.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Context</p>
                <p className="text-sm text-muted-foreground">This response had the context it needed.</p>
              </div>
            )}

            {selectedMessage.response.createdArtifact ||
            selectedMessage.response.createdApproval ||
            selectedMessage.response.createdWorkflow ? (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Created</p>
                {selectedMessage.response.createdArtifact ? (
                  <div className="rounded-2xl border border-border bg-background p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Artifact</p>
                    <p className="mt-1.5 text-sm font-semibold">{selectedMessage.response.createdArtifact.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{selectedMessage.response.createdArtifact.artifactType}</p>
                  </div>
                ) : null}
                {selectedMessage.response.createdApproval ? (
                  <div className="rounded-2xl border border-border bg-background p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Approval draft</p>
                    <p className="mt-1.5 text-sm font-semibold">{selectedMessage.response.createdApproval.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{selectedMessage.response.createdApproval.riskLevel} risk</p>
                  </div>
                ) : null}
                {selectedMessage.response.createdWorkflow ? (
                  <div className="rounded-2xl border border-border bg-background p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Workflow</p>
                    <p className="mt-1.5 text-sm font-semibold">{selectedMessage.response.createdWorkflow.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{selectedMessage.response.createdWorkflow.stepCount} steps</p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Run info</p>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p>Run ID: {selectedMessage.response.agentRunId}</p>
                <p>Credits charged: {selectedMessage.response.creditsCharged}</p>
                {selectedMessage.mode !== "auto" ? (
                  <p>Mode: {modeLabel(selectedMessage.mode as Exclude<CommandMode, "auto">)}</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </RightDetailDrawer>

      <ApprovalEditorModal
        approvalId={editingApprovalId}
        onClose={() => setEditingApprovalId(null)}
        onSaved={() => {
          if (idToken && editingApprovalId) {
            void queryClient.invalidateQueries({ queryKey: gideonQueryKeys.approval(idToken, editingApprovalId) });
            void queryClient.invalidateQueries({ queryKey: gideonQueryKeys.approvals(idToken) });
          }
        }}
      />
    </div>
  );
}
