"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  FileText,
  Forward,
  Inbox,
  Link2,
  Loader2,
  Mail,
  Pencil,
  RefreshCw,
  Reply,
  Search,
  Send,
  Sparkles,
  Star,
  Workflow,
} from "lucide-react";

import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/ToastProvider";
import { useAuth } from "@/hooks/useAuth";
import {
  useGmailStyleProfileQuery,
  useIntegrationItemQuery,
  useIntegrationWorkspaceQuery,
} from "@/hooks/useGideonQueries";
import {
  clearActiveIntegrationContext,
  writeActiveIntegrationContext,
} from "@/lib/activeIntegrationContext";
import { getFriendlyErrorMessage } from "@/lib/product";
import { cn } from "@/lib/utils";
import {
  analyzeGmailStyleProfile,
  deleteGmailStyleProfile,
  runIntegrationAction,
  syncIntegration,
  type GmailItemDetailResponse,
  type GmailThreadListItem,
} from "@/services/integrations";

const FOLDERS = [
  { id: "inbox", label: "Inbox", icon: Inbox, enabled: true },
  { id: "sent", label: "Sent", icon: Send, enabled: false },
  { id: "drafts", label: "Drafts", icon: Pencil, enabled: false },
  { id: "starred", label: "Starred", icon: Star, enabled: false },
];

const AI_ACTIONS = [
  { id: "summarizeThread", label: "Summarize thread", icon: Sparkles },
  { id: "extractActionItems", label: "Extract action items", icon: Link2 },
  { id: "draftReply", label: "Draft reply", icon: Reply },
  { id: "prepareSendApproval", label: "Prepare send approval", icon: Send },
  { id: "saveThreadSummary", label: "Save to Library", icon: FileText },
  { id: "createFollowUpWorkflow", label: "Create follow-up workflow", icon: Workflow },
];

type ComposeMode = "new" | "reply" | "forward";

type ComposeState = {
  open: boolean;
  mode: ComposeMode;
  to: string;
  cc: string;
  subject: string;
  body: string;
  loading: boolean;
  feedback: string | null;
};

function formatActionResult(actionId: string, result: Record<string, unknown>): string {
  switch (actionId) {
    case "summarizeThread":
      return `${result.summary as string}\n\nKey points:\n- ${(result.keyPoints as string[]).join("\n- ")}`;
    case "extractActionItems":
      return `${result.summary as string}\n\nAction items:\n- ${((result.actionItems ?? []) as Array<{ owner: string; task: string; dueHint?: string }>).map((i) => `${i.owner}: ${i.task}${i.dueHint ? ` (${i.dueHint})` : ""}`).join("\n- ")}`;
    case "draftReply":
      return `Subject: ${result.subject as string}\n\n${result.body as string}`;
    case "prepareSendApproval":
      return `Approval created.\n\nSubject: ${result.subject as string}\n\n${result.body as string}`;
    case "saveThreadSummary":
      return `Saved to Library: ${result.title as string}`;
    case "createFollowUpWorkflow":
      return `Workflow created: ${result.name as string}`;
    default:
      return JSON.stringify(result, null, 2);
  }
}

function formatThreadDate(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
  }

  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
  }

  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function parseEmailCsv(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  );
}

function subjectWithPrefix(subject: string, prefix: "Re:" | "Fwd:") {
  const trimmed = subject.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.toLowerCase().startsWith(prefix.toLowerCase()) ? trimmed : `${prefix} ${trimmed}`;
}

function deriveReplyRecipients(thread: GmailItemDetailResponse["detail"], accountEmail: string | null) {
  const own = (accountEmail ?? "").trim().toLowerCase();
  const participants = thread.participants
    .map((participant) => {
      const match = participant.match(/<([^>]+)>/);
      return (match?.[1] ?? participant).trim().toLowerCase();
    })
    .filter((participant) => participant && participant.includes("@") && participant !== own);

  return Array.from(new Set(participants));
}

function buildForwardBody(thread: GmailItemDetailResponse["detail"]) {
  const latestMessage = thread.messages[thread.messages.length - 1];
  const quotedBody = latestMessage?.bodyText?.trim() || latestMessage?.snippet || thread.snippet || "";

  return [
    "",
    "",
    "---------- Forwarded message ----------",
    `Subject: ${thread.subject || "(no subject)"}`,
    `From: ${latestMessage?.from || "Unknown sender"}`,
    `To: ${latestMessage?.to.join(", ") || "Unknown recipient"}`,
    quotedBody,
  ].join("\n");
}

function formatMessageDate(value: string | null) {
  if (!value) {
    return "Unknown date";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function buildWorkspaceNotice(connection: Record<string, unknown> | undefined) {
  if (!connection) {
    return null;
  }

  if (connection["status"] === "reconnect_needed" || connection["status"] === "expired") {
    return {
      title: "Reconnect Gmail to continue",
      body: "The mailbox connection needs attention before Gideon can read new threads or prepare actions safely.",
      tone: "amber",
    } as const;
  }

  if (connection["fullResyncRequired"]) {
    return {
      title: "Manual catch-up required",
      body: "Your watch history needs a bounded manual refresh. Refresh will pull the latest inbox state without starting background polling.",
      tone: "amber",
    } as const;
  }

  if (connection["watchStatus"] === "pending") {
    return {
      title: "Push sync still needs attention",
      body: "This mailbox is connected, but live Pub/Sub watch setup is still pending. The workspace remains usable with manual refresh.",
      tone: "blue",
    } as const;
  }

  if (connection["watchStatus"] === "error") {
    return {
      title: "Push sync needs review",
      body: "Watch renewal or Pub/Sub delivery needs attention. Manual refresh is still available while that gets fixed.",
      tone: "amber",
    } as const;
  }

  return null;
}

function ThreadItem({
  thread,
  selected,
  onSelect,
}: {
  thread: GmailThreadListItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-2xl border px-4 py-3 text-left transition-all",
        selected
          ? "border-blue-200 bg-blue-50/90 shadow-[0_14px_32px_-24px_rgba(37,99,235,0.65)]"
          : "border-transparent bg-white/80 hover:border-slate-200 hover:bg-white hover:shadow-[0_10px_28px_-24px_rgba(15,23,42,0.4)]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn("truncate text-sm", thread.unread ? "font-semibold text-slate-950" : "font-medium text-slate-800")}>
              {thread.from || "Unknown sender"}
            </p>
            {thread.unread ? <span className="size-2 rounded-full bg-blue-500" /> : null}
          </div>
          <p className={cn("mt-1 truncate text-sm", selected ? "text-slate-950" : "text-slate-700")}>
            {thread.subject || "(no subject)"}
          </p>
          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-500">{thread.snippet}</p>
        </div>
        <p className="shrink-0 text-[11px] font-medium text-slate-400">{formatThreadDate(thread.lastMessageAt)}</p>
      </div>
    </button>
  );
}

export function GmailWorkspacePageV2() {
  const { idToken } = useAuth();
  const { pushToast } = useToast();
  const [query, setQuery] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [activeAction, setActiveAction] = useState<{ id: string; loading: boolean; result: string | null } | null>(null);
  const [compose, setCompose] = useState<ComposeState>({
    open: false,
    mode: "new",
    to: "",
    cc: "",
    subject: "",
    body: "",
    loading: false,
    feedback: null,
  });

  const workspaceQuery = useIntegrationWorkspaceQuery("gmail", { query });
  const connection = workspaceQuery.data?.connection as Record<string, unknown> | undefined;
  const list = (workspaceQuery.data?.list ?? []) as GmailThreadListItem[];
  const isRestricted = Boolean(connection?.ownerOnly && connection?.access === "restricted");

  const threadQuery = useIntegrationItemQuery("gmail", selectedThreadId, { enabled: Boolean(selectedThreadId) });
  const threadData = threadQuery.data as GmailItemDetailResponse | undefined;
  const selectedThread = threadData?.detail;
  const selectedContextBundleId = threadData?.contextBundleId ?? null;

  const styleProfileQuery = useGmailStyleProfileQuery({ enabled: Boolean(idToken) });
  const workspaceNotice = buildWorkspaceNotice(connection);
  const accountEmail = typeof connection?.accountEmail === "string" ? connection.accountEmail : null;

  const recipientCandidates = useMemo(() => {
    if (!selectedThread) return "";
    return deriveReplyRecipients(selectedThread, accountEmail).join(", ");
  }, [accountEmail, selectedThread]);

  useEffect(() => {
    if (!list.length) {
      setSelectedThreadId(null);
      return;
    }

    if (!selectedThreadId || !list.some((thread) => thread.threadId === selectedThreadId)) {
      setSelectedThreadId(list[0]?.threadId ?? null);
    }
  }, [list, selectedThreadId]);

  useEffect(() => {
    if (connection?.status === "disconnected" || isRestricted || !selectedThreadId || !selectedContextBundleId || !selectedThread) {
      clearActiveIntegrationContext("gmail");
      return;
    }
    writeActiveIntegrationContext({
      provider: "gmail",
      itemId: selectedThreadId,
      title: selectedThread.subject,
      subtitle: selectedThread.participants.join(", "),
      contextBundleId: selectedContextBundleId,
    });
  }, [connection?.status, isRestricted, selectedContextBundleId, selectedThread, selectedThreadId]);

  async function handleRefresh() {
    if (!idToken) return;
    await syncIntegration(idToken, "gmail");
    pushToast({ title: "Inbox refreshed", description: "Pulling the latest Gmail cache into the workspace.", tone: "success" });
    void workspaceQuery.refetch();
  }

  function openCompose(mode: ComposeMode) {
    if (mode === "new" || !selectedThread) {
      setCompose({
        open: true,
        mode: "new",
        to: "",
        cc: "",
        subject: "",
        body: "",
        loading: false,
        feedback: null,
      });
      return;
    }

    if (mode === "reply") {
      setCompose({
        open: true,
        mode: "reply",
        to: deriveReplyRecipients(selectedThread, accountEmail).join(", "),
        cc: "",
        subject: subjectWithPrefix(selectedThread.subject || "", "Re:"),
        body: "",
        loading: false,
        feedback: null,
      });
      return;
    }

    setCompose({
      open: true,
      mode: "forward",
      to: "",
      cc: "",
      subject: subjectWithPrefix(selectedThread.subject || "", "Fwd:"),
      body: buildForwardBody(selectedThread),
      loading: false,
      feedback: null,
    });
  }

  function updateComposeField(field: keyof Omit<ComposeState, "open" | "mode" | "loading" | "feedback">, value: string) {
    setCompose((current) => ({
      ...current,
      [field]: value,
      feedback: null,
    }));
  }

  async function handleDraftReplyIntoComposer() {
    if (!idToken || !selectedThreadId || !selectedThread) {
      return;
    }

    setCompose((current) => ({ ...current, loading: true, feedback: null }));
    try {
      const result = await runIntegrationAction<{ subject: string; body: string }>(idToken, "gmail", "draftReply", {
        threadId: selectedThreadId,
        tone: "clear and professional",
      });
      setCompose((current) => ({
        ...current,
        loading: false,
        mode: "reply",
        to: current.to || deriveReplyRecipients(selectedThread, accountEmail).join(", "),
        subject: result.subject,
        body: result.body,
        feedback: "AI drafted a reply into the composer. Review it before drafting or sending for approval.",
      }));
    } catch (err) {
      setCompose((current) => ({
        ...current,
        loading: false,
        feedback: getFriendlyErrorMessage(err, "Couldn't draft a reply into the composer."),
      }));
    }
  }

  async function handleComposeSubmit(action: "createDraft" | "prepareSendApproval") {
    if (!idToken) {
      return;
    }

    const to = parseEmailCsv(compose.to);
    const cc = parseEmailCsv(compose.cc);
    const subject = compose.subject.trim();
    const body = compose.body.trim();

    if (!to.length || !subject || !body) {
      setCompose((current) => ({
        ...current,
        feedback: "Add at least one recipient, a subject, and a message body before continuing.",
      }));
      return;
    }

    setCompose((current) => ({ ...current, loading: true, feedback: null }));
    try {
      const payload: Record<string, unknown> = {
        to,
        cc,
        subject,
        body,
      };

      if (compose.mode === "reply" && selectedThreadId) {
        payload.threadId = selectedThreadId;
      }

      await runIntegrationAction<Record<string, unknown>>(idToken, "gmail", action, payload);
      const message =
        action === "prepareSendApproval"
          ? `Approval created for "${subject}". Review it in Approvals before Gmail sends anything.`
          : `Draft saved for "${subject}" in the connected Gmail account.`;

      setCompose((current) => ({
        ...current,
        loading: false,
        feedback: message,
      }));
      setActiveAction({
        id: action,
        loading: false,
        result:
          action === "prepareSendApproval"
            ? `Approval created.\n\nSubject: ${subject}\nTo: ${to.join(", ")}`
            : `Draft created.\n\nSubject: ${subject}\nTo: ${to.join(", ")}`,
      });
      pushToast({
        title: action === "prepareSendApproval" ? "Approval created" : "Draft created",
        description: message,
        tone: "success",
      });
    } catch (err) {
      setCompose((current) => ({
        ...current,
        loading: false,
        feedback: getFriendlyErrorMessage(
          err,
          action === "prepareSendApproval"
            ? "Couldn't create the Gmail approval."
            : "Couldn't create the Gmail draft.",
        ),
      }));
    }
  }

  async function handleAiAction(actionId: string) {
    if (!idToken || !selectedThreadId) return;
    setActiveAction({ id: actionId, loading: true, result: null });

    const payloads: Record<string, Record<string, unknown>> = {
      summarizeThread: { threadId: selectedThreadId },
      extractActionItems: { threadId: selectedThreadId },
      draftReply: { threadId: selectedThreadId, tone: "clear and professional" },
      prepareSendApproval: {
        threadId: selectedThreadId,
        to: recipientCandidates.split(",").map((value) => value.trim()).filter(Boolean),
      },
      saveThreadSummary: { threadId: selectedThreadId },
      createFollowUpWorkflow: { threadId: selectedThreadId },
    };

    try {
      const result = await runIntegrationAction<Record<string, unknown>>(idToken, "gmail", actionId, payloads[actionId] ?? {});
      setActiveAction({ id: actionId, loading: false, result: formatActionResult(actionId, result) });
    } catch (err) {
      setActiveAction({
        id: actionId,
        loading: false,
        result: getFriendlyErrorMessage(err, "This action couldn't complete. Try again."),
      });
    }
  }

  async function handleAnalyzeStyle() {
    if (!idToken) return;
    setActiveAction({ id: "analyzeStyle", loading: true, result: null });
    try {
      const result = await analyzeGmailStyleProfile(idToken);
      await styleProfileQuery.refetch();
      setActiveAction({
        id: "analyzeStyle",
        loading: false,
        result: `Sampled ${result.profile.sampleSize} sent emails.\n\n${result.profile.summary}`,
      });
    } catch (err) {
      setActiveAction({
        id: "analyzeStyle",
        loading: false,
        result: getFriendlyErrorMessage(err, "Couldn't build a writing style profile."),
      });
    }
  }

  async function handleResetStyle() {
    if (!idToken) return;
    await deleteGmailStyleProfile(idToken);
    await styleProfileQuery.refetch();
    pushToast({ title: "Style reset", description: "Writing style profile removed.", tone: "success" });
  }

  if (workspaceQuery.isLoading && !workspaceQuery.data) {
    return <LoadingState label="Loading Gmail workspace..." rows={4} />;
  }

  if (workspaceQuery.error) {
    return (
      <ErrorState
        message={getFriendlyErrorMessage(workspaceQuery.error, "Couldn't open Gmail.")}
        onRetry={() => void workspaceQuery.refetch()}
      />
    );
  }

  if (connection?.status === "disconnected") {
    return (
      <div className="rounded-[30px] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.35)]">
        <div className="mx-auto max-w-xl text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <Mail className="size-6" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-950">Connect Gmail to open this workspace</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            The Gmail workspace shows your cached inbox, selected thread context, and approval-gated actions once the integration is connected.
          </p>
          <div className="mt-6">
            <Button asChild className="rounded-xl px-6">
              <Link href="/integrations/gmail">Go to Gmail integration</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden rounded-[32px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.10),transparent_26%),linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] shadow-[0_28px_70px_-42px_rgba(15,23,42,0.4)]">
      <div className="border-b border-slate-200/80 bg-white/85 px-5 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex w-full items-center gap-2 mb-1 text-[13px] text-muted-foreground">
            <Link href="/integrations" className="transition-colors hover:text-slate-900">Integrations</Link>
            <span className="text-slate-300">/</span>
            <Link href="/integrations/gmail" className="transition-colors hover:text-slate-900">Gmail</Link>
            <span className="text-slate-300">/</span>
            <span className="font-medium text-slate-900">Workspace</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm">
              <Mail className="size-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight text-slate-950">Gmail</h1>
                {connection?.status ? <StatusPill status={String(connection.status)} /> : null}
              </div>
              <p className="text-xs text-slate-500">
                {typeof connection?.accountEmail === "string" && connection.accountEmail
                  ? connection.accountEmail
                  : "Owner-only mailbox workspace"}
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 rounded-xl border-slate-200 bg-white"
              onClick={() => openCompose("new")}
              disabled={isRestricted || connection?.status === "reconnect_needed" || connection?.status === "expired"}
            >
              <Pencil className="size-3.5" />
              Compose
            </Button>
            {typeof connection?.watchStatus === "string" && connection.watchStatus ? (
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                Sync: {connection.watchStatus.replaceAll("_", " ")}
              </span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-xl border-slate-200 bg-white"
              onClick={() => void handleRefresh()}
              disabled={!idToken || isRestricted || connection?.status === "reconnect_needed" || connection?.status === "expired"}
            >
              <RefreshCw className="size-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        {workspaceNotice ? (
          <div
            className={cn(
              "mt-4 rounded-2xl border px-4 py-3 text-sm",
              workspaceNotice.tone === "blue"
                ? "border-sky-200 bg-sky-50/80 text-sky-900"
                : "border-amber-200 bg-amber-50/85 text-amber-950",
            )}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", workspaceNotice.tone === "blue" ? "text-sky-600" : "text-amber-600")} />
              <div>
                <p className="font-medium">{workspaceNotice.title}</p>
                <p className="mt-1 leading-6 opacity-90">{workspaceNotice.body}</p>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[220px_340px_minmax(0,1fr)] overflow-hidden">
        <aside className="flex min-h-0 flex-col border-r border-slate-200/80 bg-white/70 px-3 py-4 backdrop-blur">
          <div className="rounded-[24px] border border-slate-200/80 bg-white/80 p-3 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Mailbox</p>
            <div className="mt-3 space-y-1">
              {FOLDERS.map(({ id, label, icon: Icon, enabled }) => (
                <button
                  key={id}
                  type="button"
                  disabled={!enabled}
                  className={cn(
                    "flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-sm transition-colors",
                    id === "inbox"
                      ? "bg-blue-50 text-blue-950"
                      : enabled
                        ? "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        : "cursor-not-allowed text-slate-400",
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="size-4" />
                    {label}
                  </span>
                  {!enabled ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">Soon</span> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-[24px] border border-slate-200/80 bg-white/80 p-3 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Voice profile</p>
            <p className="mt-2 px-2 text-xs leading-5 text-slate-500">
              Draft replies can borrow your sent-email tone once you analyze recent messages.
            </p>
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={() => void handleAnalyzeStyle()}
                className="flex w-full items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950"
                disabled={isRestricted}
              >
                <Sparkles className="size-4" />
                Analyze writing style
              </button>
              {styleProfileQuery.data?.profile ? (
                <button
                  type="button"
                  onClick={() => void handleResetStyle()}
                  className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
                >
                  Reset style profile
                </button>
              ) : null}
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col border-r border-slate-200/80 bg-slate-50/65">
          <div className="border-b border-slate-200/80 px-4 py-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search cached inbox threads..."
                className="h-10 w-full rounded-2xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                disabled={isRestricted}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {isRestricted ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-500">
                Gmail content is restricted to the user who connected this mailbox.
              </div>
            ) : workspaceQuery.isFetching && !list.length ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-slate-400" />
              </div>
            ) : list.length ? (
              <div className="space-y-2">
                {list.map((thread) => (
                  <ThreadItem
                    key={thread.threadId}
                    thread={thread}
                    selected={selectedThreadId === thread.threadId}
                    onSelect={() => setSelectedThreadId(thread.threadId)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-white/90 p-8 text-center text-sm text-slate-500">
                <Mail className="mx-auto mb-3 size-9 text-slate-300" />
                <p className="font-medium text-slate-700">No cached emails yet</p>
                <p className="mt-2 leading-6">
                  Use manual refresh to pull a bounded slice of the latest inbox into this workspace.
                </p>
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
                >
                  Refresh inbox
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="relative flex min-h-0 flex-1 flex-col bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(248,251,255,0.98))]">
          {!selectedThreadId ? (
            <div className="flex flex-1 items-center justify-center px-8 text-sm text-slate-500">
              <div className="max-w-sm text-center">
                <Mail className="mx-auto mb-3 size-10 text-slate-300" />
                <p className="text-base font-medium text-slate-800">Select a thread to read it here</p>
                <p className="mt-2 leading-6">
                  The selected email becomes active context for summaries, drafting, and command planning.
                </p>
                <Button className="mt-5 rounded-xl" onClick={() => openCompose("new")} disabled={isRestricted}>
                  Compose new email
                </Button>
              </div>
            </div>
          ) : threadQuery.isLoading && !selectedThread ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-slate-400" />
            </div>
          ) : threadQuery.error ? (
            <ErrorState
              message={getFriendlyErrorMessage(threadQuery.error, "Couldn't load this thread.")}
              onRetry={() => void threadQuery.refetch()}
            />
          ) : selectedThread ? (
            <>
              <div className="border-b border-slate-200/80 bg-white/85 px-6 py-5 backdrop-blur">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Selected thread</p>
                    <h2 className="mt-2 text-[1.35rem] font-semibold leading-8 tracking-tight text-slate-950">
                      {selectedThread.subject || "(no subject)"}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{selectedThread.participants.join(", ")}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 rounded-xl border-slate-200 bg-white"
                      onClick={() => openCompose("reply")}
                      disabled={isRestricted}
                    >
                      <Reply className="size-3.5" />
                      Reply
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 rounded-xl border-slate-200 bg-white"
                      onClick={() => openCompose("forward")}
                      disabled={isRestricted}
                    >
                      <Forward className="size-3.5" />
                      Forward
                    </Button>
                    <div className="relative">
                      <Button
                        size="sm"
                        className="gap-1.5 rounded-xl"
                        onClick={() => setAiPanelOpen((open) => !open)}
                        disabled={isRestricted}
                      >
                        <Sparkles className="size-3.5" />
                        AI Actions
                        <ChevronDown className="size-3.5" />
                      </Button>
                      {aiPanelOpen ? (
                        <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-1 shadow-[0_24px_50px_-24px_rgba(15,23,42,0.35)]">
                          {AI_ACTIONS.map(({ id, label, icon: Icon }) => (
                            <button
                              key={id}
                              type="button"
                              onClick={() => {
                                setAiPanelOpen(false);
                                void handleAiAction(id);
                              }}
                              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950"
                            >
                              <Icon className="size-4 text-slate-400" />
                              {label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {compose.open ? (
                  <div className="mb-5 rounded-[26px] border border-slate-200/80 bg-white/96 p-5 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {compose.mode === "new" ? "Compose" : compose.mode === "reply" ? "Reply draft" : "Forward draft"}
                        </p>
                        <h3 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">
                          {compose.mode === "new"
                            ? "Prepare a new outbound email"
                            : compose.mode === "reply"
                              ? "Reply from the selected thread"
                              : "Forward the selected thread"}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          Review the copy here, then either save a Gmail draft or send it for approval directly from this workspace.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setCompose((current) => ({
                            ...current,
                            open: false,
                            loading: false,
                            feedback: null,
                          }))
                        }
                        className="text-sm font-medium text-slate-500 hover:text-slate-900"
                      >
                        Close
                      </button>
                    </div>

                    <div className="mt-5 space-y-4">
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">To</span>
                        <input
                          value={compose.to}
                          onChange={(event) => updateComposeField("to", event.target.value)}
                          placeholder="name@example.com, another@example.com"
                          className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Cc</span>
                        <input
                          value={compose.cc}
                          onChange={(event) => updateComposeField("cc", event.target.value)}
                          placeholder="Optional comma-separated recipients"
                          className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Subject</span>
                        <input
                          value={compose.subject}
                          onChange={(event) => updateComposeField("subject", event.target.value)}
                          placeholder="Subject line"
                          className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Body</span>
                        <textarea
                          value={compose.body}
                          onChange={(event) => updateComposeField("body", event.target.value)}
                          placeholder="Write the email body here..."
                          rows={10}
                          className="w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </label>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      {compose.mode === "reply" ? (
                        <Button
                          variant="outline"
                          className="rounded-xl border-slate-200 bg-white"
                          onClick={() => void handleDraftReplyIntoComposer()}
                          disabled={compose.loading}
                        >
                          {compose.loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
                          Draft with AI
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        className="rounded-xl border-slate-200 bg-white"
                        onClick={() => void handleComposeSubmit("createDraft")}
                        disabled={compose.loading}
                      >
                        {compose.loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Pencil className="mr-2 size-4" />}
                        Create Gmail draft
                      </Button>
                      <Button
                        className="rounded-xl"
                        onClick={() => void handleComposeSubmit("prepareSendApproval")}
                        disabled={compose.loading}
                      >
                        {compose.loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Send className="mr-2 size-4" />}
                        Send for approval
                      </Button>
                    </div>

                    {compose.feedback ? (
                      <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm leading-6 text-blue-950">
                        {compose.feedback}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="space-y-4">
                  {selectedThread.messages.map((message) => (
                    <article
                      key={message.id}
                      className="rounded-[26px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-950">{message.from}</p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            To: {message.to.join(", ") || "Unknown"}
                            {message.cc.length > 0 ? ` · Cc: ${message.cc.join(", ")}` : ""}
                          </p>
                        </div>
                        <p className="shrink-0 text-xs font-medium text-slate-400">{formatMessageDate(message.sentAt)}</p>
                      </div>
                      <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                        {message.bodyText || message.snippet}
                      </p>
                    </article>
                  ))}
                </div>
              </div>

              {activeAction ? (
                <div className="border-t border-slate-200/80 bg-white/90 px-6 py-4 backdrop-blur">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600">
                        {AI_ACTIONS.find((action) => action.id === activeAction.id)?.label ?? "AI Result"}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">Grounded in the selected thread context.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveAction(null)}
                      className="text-xs font-medium text-slate-500 hover:text-slate-900"
                    >
                      Dismiss
                    </button>
                  </div>
                  {activeAction.loading ? (
                    <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="size-4 animate-spin" />
                      Working...
                    </div>
                  ) : (
                    <pre className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-800">
                      {activeAction.result}
                    </pre>
                  )}
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
