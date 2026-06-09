"use client";

import Link from "next/link";

import { useRef, useState } from "react";
import { ArrowUp, Bot, BookOpen, Clock, Database, Edit2, File, FileText, GitFork, Link2, ListTodo, MoreHorizontal, Plus, Presentation, Search, Sparkles, Trash2, Users, X, Zap } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/ToastProvider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActiveIntegrationContext } from "@/lib/activeIntegrationContext";
import type { VisibleAgent } from "@/services/agents";
import type { CommandMode } from "@/services/command";
import type { DashboardSummary } from "@/services/dashboard";
import { PageSection, SummaryRow } from "@/components/app-shell/ProductPrimitives";

import { modeLabel, quickSlashModes, slashModes, type Session } from "./types";

type IdleViewProps = {
  command: string;
  onCommandChange: (value: string) => void;
  selectedMode: Exclude<CommandMode, "auto"> | null;
  selectedAgentId: string | null;
  availableAgents: VisibleAgent[];
  activeIntegrationContext: ActiveIntegrationContext | null;
  onClearIntegrationContext: () => void;
  onSelectMode: (mode: Exclude<CommandMode, "auto"> | null) => void;
  onSelectAgent: (id: string | null) => void;
  onSubmit: (query: string, mode: CommandMode, agentId: string | null) => void;
  summary: DashboardSummary;
  loadingSummary: boolean;
  summaryError: string | null;
  setupProgress: number;
  onRefreshSummary: () => void;
  recentSessions: Session[];
  onContinueSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, currentTitle: string) => void;
};

const promptStarters = [
  "Summarize my priorities",
  "/search startup grants for early-stage startups",
  "/search compare top competitor positioning",
];

function formatRelativeTime(isoString: string) {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function artifactIcon(artifactType: string) {
  const t = artifactType.toLowerCase();
  if (t.includes("report")) return Presentation;
  if (t.includes("research")) return Search;
  if (t.includes("brief") || t.includes("summary")) return FileText;
  if (t.includes("draft")) return BookOpen;
  if (t.includes("task") || t.includes("todo") || t.includes("data")) return ListTodo;
  return File;
}

export function IdleView({
  command,
  onCommandChange,
  selectedMode,
  selectedAgentId,
  availableAgents,
  activeIntegrationContext,
  onClearIntegrationContext,
  onSelectMode,
  onSelectAgent,
  onSubmit,
  summary,
  loadingSummary,
  summaryError,
  setupProgress,
  onRefreshSummary,
  recentSessions,
  onContinueSession,
  onDeleteSession,
  onRenameSession,
}: IdleViewProps) {
  const { pushToast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showAllSessions, setShowAllSessions] = useState(false);

  const slashMatch = command.match(/^\s*\/([a-z_]*)$/i)?.[1] ?? null;
  const slashSuggestions =
    slashMatch === null
      ? []
      : slashModes.filter((m) => m.slash.slice(1).startsWith(slashMatch.toLowerCase()));

  const selectedAgent = availableAgents.find((a) => a.id === selectedAgentId) ?? null;
  const contextPromptStarters = activeIntegrationContext
    ? activeIntegrationContext.provider === "gmail"
      ? ["Summarize this thread", "Draft a reply in my tone", "Extract action items from this email"]
      : ["Summarize this CRM record", "Draft a follow-up note", "Spot risks and next steps"]
    : promptStarters;
  const composerPlaceholder = activeIntegrationContext
    ? activeIntegrationContext.provider === "gmail"
      ? "Ask about the selected Gmail thread, or type /search, /extract, or /workflow..."
      : "Ask about the selected HubSpot record, or type /search, /extract, or /workflow..."
    : "Ask Gideon anything, or type /search, /extract, or /workflow...";

  function handleSelectMode(mode: Exclude<CommandMode, "auto">) {
    onSelectMode(mode);
    onCommandChange(command.replace(/^\s*\/(search|research|extract|workflow)\b/i, "").trimStart());
    textareaRef.current?.focus();
  }

  function handleAddUrl() {
    onCommandChange(command.includes("http") ? command : `${command}${command ? "\n" : ""}https://`);
    textareaRef.current?.focus();
  }

  function handleChooseAgent(agent: VisibleAgent) {
    const isActive = agent.status === "active";
    if (!isActive) {
      pushToast({
        title: `${agent.name} isn't active`,
        description:
          agent.status === "disabled"
            ? "This agent is disabled. Enable it on the Agents page."
            : "Activate this agent on the Agents page to use it in commands.",
        tone: "default",
      });
      return;
    }

    onSelectAgent(agent.id);
  }

  function handleSubmit() {
    const trimmed = command.trim();
    if (!trimmed) return;
    onSubmit(trimmed, selectedMode ?? "auto", selectedAgentId);
  }

  const stats = [
    {
      label: "Pending Approvals",
      value: summary.pendingApprovals,
      detail: summary.pendingApprovals > 0 ? "Actions waiting for your sign-off." : "No actions waiting.",
      icon: Zap,
      iconColor: summary.pendingApprovals > 0 ? "text-primary bg-primary/10" : "text-muted-foreground bg-muted",
      actionColor: "text-primary hover:text-primary/80",
      action: summary.pendingApprovals > 0 ? { label: "Review now →", href: "/approvals" } : null,
    },
    {
      label: "Active Workflows",
      value: summary.activeWorkflowRuns,
      detail: "Automations moving forward.",
      icon: GitFork,
      iconColor: "text-blue-600 bg-blue-50",
      actionColor: "",
      action: null,
    },
    {
      label: "Active Assistants",
      value: summary.activeAgents,
      detail: "Specialists ready to help.",
      icon: Users,
      iconColor: "text-emerald-600 bg-emerald-50",
      actionColor: "",
      action: null,
    },
  ];

  if (summary.needsReviewMemoryCount > 0 || summary.needsReviewMemoryCount === 0) {
    stats.push({
      label: "Pending Context",
      value: summary.needsReviewMemoryCount,
      detail: "New facts waiting for review.",
      icon: Database,
      iconColor: "text-orange-500 bg-orange-50",
      actionColor: "text-orange-600 hover:text-orange-700",
      action: summary.needsReviewMemoryCount > 0 ? { label: "Review facts →", href: "/context" } : null,
    });
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="mx-auto flex max-w-4xl flex-col items-center pt-4 md:pt-8">
        <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/5 text-primary shadow-sm ring-1 ring-primary/10">
          <Sparkles className="size-5" />
        </div>
        <div className="mt-4 text-center">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl text-foreground">
            Good morning, {summary.activeAgents > 0 ? "ready to start?" : "ready to start?"}
          </h1>
          <p className="mt-3 text-sm font-medium text-muted-foreground/80">
            Ask Gideon to summarize, search, research, extract, or plan a workflow.
          </p>
        </div>

        <div className="mt-8 w-full max-w-4xl">
          {activeIntegrationContext ? (
            <div className="mb-4 rounded-3xl border border-primary/15 bg-primary/5 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-primary">
                    Pinned {activeIntegrationContext.provider === "gmail" ? "Gmail thread" : "HubSpot record"}:{" "}
                    <span className="font-semibold">{activeIntegrationContext.title}</span>
                  </p>
                  <p className="mt-1 text-xs leading-5 text-primary/80">
                    Gideon will use this as the primary context for this command. Clear only removes the pinned context from chat scope. It does not disconnect the integration.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClearIntegrationContext}
                  className="shrink-0 rounded-full px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : null}
          <form
            onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
            className="relative flex flex-col rounded-[2rem] border border-border bg-white p-3 shadow-[0_4px_24px_rgba(30,20,80,0.06)] transition-all focus-within:ring-4 focus-within:ring-primary/10 hover:shadow-panel"
          >
            {(selectedMode || selectedAgent) ? (
              <div className="flex flex-wrap gap-1.5 px-4 pt-2 pb-0">
                {selectedMode ? (
                  <button
                    type="button"
                    onClick={() => onSelectMode(null)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[11px] font-medium text-primary"
                  >
                    {modeLabel(selectedMode)}
                    <X className="size-2.5" />
                  </button>
                ) : null}
                {selectedAgent ? (
                  <button
                    type="button"
                    onClick={() => onSelectAgent(null)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium text-foreground"
                  >
                    <Bot className="size-3 text-primary" />
                    {selectedAgent.name}
                    <X className="size-2.5" />
                  </button>
                ) : null}
              </div>
            ) : null}

            <textarea
              ref={textareaRef}
              value={command}
              onChange={(e) => onCommandChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={composerPlaceholder}
              className="min-h-[80px] w-full resize-none bg-transparent px-5 py-4 text-base outline-none placeholder:text-muted-foreground/60"
              autoFocus
            />

            {slashSuggestions.length ? (
              <div className="mx-3 mb-2 rounded-3xl border border-border/50 bg-background/80 p-2 shadow-sm backdrop-blur-md">
                {slashSuggestions.map((mode) => {
                  const Icon = mode.icon;
                  return (
                    <button
                      key={mode.mode}
                      type="button"
                      onClick={() => handleSelectMode(mode.mode)}
                      className="flex w-full items-start gap-3 rounded-2xl px-3 py-2 text-left transition hover:bg-white"
                    >
                      <div className="mt-0.5 rounded-xl bg-white p-2 text-primary shadow-sm">
                        <Icon className="size-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{mode.slash}</p>
                        <p className="text-xs leading-5 text-muted-foreground">{mode.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-2">
              <div className="flex flex-wrap items-center gap-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="size-9 rounded-full border-border/80 text-muted-foreground hover:text-foreground"
                      title="Quick actions"
                    >
                      <Plus className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[16rem]">
                    <DropdownMenuLabel>Quick actions</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault();
                        handleAddUrl();
                      }}
                    >
                      <Link2 className="mr-2 size-4" />
                      Add URL
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="inline-flex h-9 items-center gap-2 rounded-full bg-secondary/60 px-4 text-sm font-medium text-foreground transition hover:bg-secondary">
                      {selectedMode ? (
                        <>
                          {slashModes.find(m => m.mode === selectedMode)?.icon ? (
                            <Sparkles className="size-3.5 text-primary" />
                          ) : <Sparkles className="size-3.5 text-primary" />}
                          {modeLabel(selectedMode)}
                        </>
                      ) : (
                        <>
                          <Sparkles className="size-3.5 text-primary" />
                          Default
                        </>
                      )}
                      <span className="ml-1 text-[10px] opacity-50">▼</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[18rem]">
                    <DropdownMenuLabel>Choose mode</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onSelectMode(null)}>Default</DropdownMenuItem>
                    {slashModes.map((mode) => (
                      <DropdownMenuItem key={mode.mode} onSelect={() => handleSelectMode(mode.mode)}>
                        {mode.slash}{mode.advanced ? " (manual deep report)" : ""}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-border/80 bg-white px-4 text-sm font-medium text-foreground transition hover:bg-secondary/40"
                    >
                      <Bot className="size-3.5 text-primary" />
                      {selectedAgent?.name ?? "Any agent"}
                      <span className="ml-1 text-[10px] opacity-50">▼</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[20rem]">
                    <DropdownMenuLabel>Choose agent</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onSelectAgent(null)}>No specific agent</DropdownMenuItem>
                    {availableAgents.map((agent) => {
                      const isActive = agent.status === "active";
                      return (
                        <DropdownMenuItem
                          key={agent.id}
                          onSelect={() => handleChooseAgent(agent)}
                          className={isActive ? "" : "opacity-50"}
                        >
                          <div className="space-y-0.5">
                            <p className="text-sm font-medium">
                              {agent.name}
                              {!isActive ? (
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                  ({agent.status === "disabled" ? "disabled" : "needs setup"})
                                </span>
                              ) : null}
                            </p>
                            {agent.description ? (
                              <p className="text-xs leading-5 text-muted-foreground">{agent.description}</p>
                            ) : null}
                          </div>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>

                <span className="hidden text-xs text-muted-foreground sm:inline-block">
                  {selectedAgent
                    ? `${selectedAgent.name} selected`
                    : selectedMode
                      ? modeLabel(selectedMode)
                      : "Gideon picks the best approach."}
                </span>
              </div>

              <Button
                type="submit"
                size="icon"
                disabled={!command.trim()}
                className="size-10 rounded-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                <ArrowUp className="size-5" />
              </Button>
            </div>
          </form>

          {/* Mode chips */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => onSelectMode(null)}
              className={[
                "inline-flex h-9 items-center gap-2 rounded-full px-5 text-sm font-medium transition-colors",
                selectedMode === null
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "border border-border/80 bg-white text-muted-foreground hover:text-foreground hover:shadow-sm",
              ].join(" ")}
            >
              <Sparkles className="size-3.5" />
              Default
            </button>
            {quickSlashModes.map((mode) => {
              const Icon = mode.icon;
              return (
                <button
                  key={mode.mode}
                  type="button"
                  onClick={() => handleSelectMode(mode.mode)}
                  className={[
                    "inline-flex h-9 items-center gap-2 rounded-full px-5 text-sm font-medium transition-colors",
                    selectedMode === mode.mode
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "border border-border/80 bg-white text-muted-foreground hover:text-foreground hover:shadow-sm",
                  ].join(" ")}
                >
                  <Icon className="size-3.5" />
                  {mode.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {contextPromptStarters.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => onCommandChange(starter)}
                className="rounded-full border border-border/60 bg-white px-5 py-2 text-sm font-medium text-muted-foreground shadow-sm transition hover:border-primary/30 hover:text-foreground"
              >
                {starter}
              </button>
            ))}
          </div>
        </div>
      </div>

      {summaryError ? <ErrorState message={summaryError} onRetry={onRefreshSummary} /> : null}

      <div className="px-2 xl:px-4">
        {loadingSummary ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((card) => (
              <div key={card.label} className="rounded-3xl border border-border/60 bg-white p-6">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="mt-4 h-8 w-1/3" />
                <Skeleton className="mt-3 h-3 w-5/6" />
              </div>
            ))}
          </div>
        ) : (
          <SummaryRow
            items={stats.map((card) => ({
              label: card.label,
              value: card.value,
              detail: card.detail,
              icon: card.icon,
              tone:
                card.label === "Pending Approvals"
                  ? card.value > 0
                    ? "primary"
                    : "neutral"
                  : card.label === "Active Assistants"
                    ? "success"
                    : card.label === "Pending Context"
                      ? "warning"
                      : "neutral",
              actionLabel: card.action?.label,
              actionHref: card.action?.href,
            }))}
          />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] px-2 xl:px-4">
        {/* Recent sessions */}
        <PageSection
          title="Recent sessions"
          description="Continue from recent command threads, reopen context, and pick up active operating work quickly."
          className="min-w-0"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">Conversation history</p>
            </div>
            {recentSessions.length > 3 ? (
              <button
                type="button"
                onClick={() => setShowAllSessions((v: boolean) => !v)}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold text-foreground hover:bg-secondary"
              >
                {showAllSessions ? "Show less" : "View all"}
              </button>
            ) : null}
          </div>
          <div className="mt-5 space-y-3">
            {recentSessions.length === 0 ? (
              <EmptyState
                icon={<Clock className="size-6" />}
                title="No recent sessions"
                description="Start a conversation above."
              />
            ) : (
              (showAllSessions ? recentSessions : recentSessions.slice(0, 3)).map((session) => {
                const modeConfig = slashModes.find(
                  (m) => m.mode === session.mode || (m.mode === "extract_url" && session.mode === "extract"),
                );
                const ModeIcon = modeConfig?.icon ?? Sparkles;
                const modeLabelStr = modeConfig?.slash ?? (session.mode === "default" ? "Chat" : "Task");
                return (
                  <div
                    key={session.id}
                    className="group flex w-full items-center gap-2 rounded-2xl border border-transparent p-2 transition hover:border-border/40 hover:bg-secondary/40 hover:shadow-sm"
                  >
                    <button
                      type="button"
                      onClick={() => onContinueSession(session.id)}
                      className="flex min-w-0 flex-1 items-center gap-4 text-left"
                    >
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <ModeIcon className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold leading-5 text-foreground">
                          {session.title || session.firstQuery}
                        </p>
                        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                          {session.lastMessagePreview || "Started a new session"}
                        </p>
                      </div>
                    </button>
                    <div className="ml-2 flex shrink-0 items-center gap-3 pr-2">
                      {modeLabelStr && (
                        <span className="hidden rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-600 sm:inline-block">
                          {modeLabelStr}
                        </span>
                      )}
                      <span className="w-16 text-right text-[13px] font-medium text-muted-foreground">
                        {formatRelativeTime(session.updatedAt)}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 rounded-full text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-white hover:text-foreground"
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onRenameSession(session.id, session.title || session.firstQuery)}>
                            <Edit2 className="mr-2 size-4" /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => onDeleteSession(session.id)} className="text-red-600 focus:bg-red-50 focus:text-red-700">
                            <Trash2 className="mr-2 size-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </PageSection>

        <div className="min-w-0 space-y-4">
          {/* Workspace health */}
          <PageSection
            title="Workspace health"
            description="A quick read on how ready Gideon is to act with the right context and setup."
          >
            <div className="flex items-center gap-2">
              <Zap className="size-4 text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">Readiness score</p>
            </div>
            <div className="mt-6 flex items-center gap-6">
              <div className="relative flex size-20 shrink-0 items-center justify-center">
                <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="16" fill="none" className="stroke-secondary" strokeWidth="4" />
                  <circle
                    cx="18"
                    cy="18"
                    r="16"
                    fill="none"
                    className="stroke-primary transition-all duration-1000 ease-out"
                    strokeWidth="4"
                    strokeDasharray="100"
                    strokeDashoffset={100 - (setupProgress || 72)}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="text-lg font-bold text-foreground">{setupProgress || 72}%</span>
              </div>
              <div>
                <p className="text-base font-bold text-primary">
                  {(setupProgress || 72) > 80 ? "Excellent" : (setupProgress || 72) > 50 ? "Healthy" : "Needs setup"}
                </p>
                <p className="text-[13px] font-medium text-muted-foreground">Your workspace is in good shape.</p>
              </div>
            </div>
            <div className="mt-6 space-y-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex size-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <p className="text-[13px] font-medium text-muted-foreground">Profile & workspace set up</p>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="flex size-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <p className="text-[13px] font-medium text-muted-foreground">At least 1 integration connected</p>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="flex size-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <p className="text-[13px] font-medium text-muted-foreground">Memory enabled</p>
              </div>
            </div>
            <Link href="/onboarding" className="mt-5 inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
              View recommendations &rarr;
            </Link>
          </PageSection>

          {/* Today's focus */}
          <PageSection
            title="Today's focus"
            description="Keep the day anchored around the few things that matter most."
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Sparkles className="size-3.5" />
                </div>
                <p className="text-sm font-semibold text-foreground">Priority reminders</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-[13px] font-medium text-muted-foreground">Focus on what matters most today.</p>
              <button className="flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
                <Plus className="size-3.5" /> Add focus item
              </button>
            </div>
          </PageSection>
        </div>
      </div>
    </div>
  );
}
