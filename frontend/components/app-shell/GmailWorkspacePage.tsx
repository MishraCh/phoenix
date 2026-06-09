"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Link2, Mail, RefreshCw, Send, Sparkles, Workflow } from "lucide-react";

import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/ToastProvider";
import { useAuth } from "@/hooks/useAuth";
import { useGmailStyleProfileQuery, useIntegrationItemQuery, useIntegrationWorkspaceQuery } from "@/hooks/useGideonQueries";
import { clearActiveIntegrationContext, writeActiveIntegrationContext } from "@/lib/activeIntegrationContext";
import { getFriendlyErrorMessage } from "@/lib/product";
import {
  analyzeGmailStyleProfile,
  connectIntegration,
  deleteGmailStyleProfile,
  disconnectIntegration,
  runIntegrationAction,
  syncIntegration,
  type GmailItemDetailResponse,
  type GmailThreadListItem,
} from "@/services/integrations";

import { ProductHeader } from "./ProductHeader";
import { SummaryRow } from "./ProductPrimitives";

type GmailWorkspacePageProps = {
  provider: string;
};

export function GmailWorkspacePage({ provider }: GmailWorkspacePageProps) {
  const { idToken } = useAuth();
  const { pushToast } = useToast();
  const [query, setQuery] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [actionState, setActionState] = useState<{ loading: boolean; title: string; body: string } | null>(null);
  const workspaceQuery = useIntegrationWorkspaceQuery(provider, { query });
  const connection = workspaceQuery.data?.connection;
  const list = (workspaceQuery.data?.list ?? []) as GmailThreadListItem[];
  const threadQuery = useIntegrationItemQuery(provider, selectedThreadId, { enabled: Boolean(selectedThreadId) });
  const threadData = threadQuery.data as GmailItemDetailResponse | undefined;
  const selectedThread = threadData?.detail;
  const selectedContextBundleId = threadData?.contextBundleId ?? null;
  const styleProfileQuery = useGmailStyleProfileQuery({ enabled: Boolean(idToken) });
  const styleProfile = styleProfileQuery.data?.profile ?? null;
  const isRestricted = Boolean(connection?.ownerOnly && connection?.access === "restricted");

  const recipientCandidates = useMemo(() => {
    if (!selectedThread?.participants?.length) {
      return "";
    }

    return selectedThread.participants.join(", ");
  }, [selectedThread]);

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

  async function handleConnect() {
    if (!idToken) return;
    const result = await connectIntegration(idToken, provider);
    window.location.href = result.authUrl;
  }

  async function handleSync() {
    if (!idToken) return;
    await syncIntegration(idToken, provider);
    pushToast({ title: "Gmail refresh queued", description: "A bounded inbox catch-up has started.", tone: "success" });
    void workspaceQuery.refetch();
  }

  async function handleDisconnect() {
    if (!idToken) return;
    await disconnectIntegration(idToken, provider);
    clearActiveIntegrationContext("gmail");
    pushToast({ title: "Gmail disconnected", description: "The connection has been safely removed.", tone: "success" });
    setSelectedThreadId(null);
    void workspaceQuery.refetch();
  }

  async function handleAction<T>(
    title: string,
    action: string,
    payload: Record<string, unknown>,
    format: (result: T) => string,
  ) {
    if (!idToken) return;
    setActionState({ loading: true, title, body: "Working..." });
    try {
      const result = await runIntegrationAction<T>(idToken, provider, action, payload);
      setActionState({ loading: false, title, body: format(result) });
      void workspaceQuery.refetch();
    } catch (error) {
      setActionState({
        loading: false,
        title,
        body: getFriendlyErrorMessage(error, "This Gmail action needs attention."),
      });
    }
  }

  async function handleAnalyzeStyle() {
    if (!idToken) return;
    setActionState({ loading: true, title: "Writing style profile", body: "Analyzing sent Gmail samples..." });
    try {
      const result = await analyzeGmailStyleProfile(idToken);
      await styleProfileQuery.refetch();
      setActionState({
        loading: false,
        title: "Writing style profile",
        body: `Sampled ${result.profile.sampleSize} sent emails.\n\n${result.profile.summary}`,
      });
    } catch (error) {
      setActionState({
        loading: false,
        title: "Writing style profile",
        body: getFriendlyErrorMessage(error, "Gideon couldn't build a writing style profile yet."),
      });
    }
  }

  async function handleResetStyle() {
    if (!idToken) return;
    await deleteGmailStyleProfile(idToken);
    await styleProfileQuery.refetch();
    pushToast({ title: "Writing style reset", description: "The saved Gmail style profile was removed.", tone: "success" });
  }

  if (workspaceQuery.isLoading && !workspaceQuery.data) {
    return <LoadingState label="Loading Gmail workspace..." rows={4} />;
  }

  if (workspaceQuery.error) {
    return (
      <ErrorState
        message={getFriendlyErrorMessage(workspaceQuery.error, "We couldn't open Gmail right now.")}
        onRetry={() => void workspaceQuery.refetch()}
      />
    );
  }

  return (
    <section className="space-y-6">
      <ProductHeader
        eyebrow="Integrations"
        title="Gmail workspace"
        description="Browse recent threads, open one in context, and use Gideon actions without losing the selected email thread."
        meta={
          <SummaryRow
            className="md:grid-cols-2 xl:grid-cols-4"
            items={[
              {
                label: "Mailbox",
                value: connection?.accountEmail ? "Connected" : "Not connected",
                detail: connection?.accountEmail ?? "Connect Gmail to start bringing inbox context into Gideon.",
                icon: Mail,
                tone: connection?.accountEmail ? "success" : "neutral",
              },
              {
                label: "Visible threads",
                value: list.length,
                detail: "Recent cached or synced inbox threads available in this workspace view.",
                icon: FileText,
                tone: list.length > 0 ? "primary" : "neutral",
              },
              {
                label: "Selected thread",
                value: selectedThreadId ? "Active" : "None",
                detail: selectedThread?.subject ?? "Choose a thread to carry its context into Gideon actions.",
                icon: Link2,
                tone: selectedThreadId ? "warning" : "neutral",
              },
              {
                label: "Writing style",
                value: styleProfile ? "Profiled" : "Not set",
                detail: styleProfile
                  ? "Reply drafts can now mirror your usual tone and structure more closely."
                  : "Analyze sent mail to personalize drafted replies.",
                icon: Sparkles,
                tone: styleProfile ? "success" : "neutral",
              },
            ]}
          />
        }
        action={connection ? <StatusPill status={connection.status} /> : null}
      />

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => void handleConnect()} disabled={!idToken}>
          Connect Gmail
        </Button>
        <Button
          variant="outline"
          onClick={() => void handleSync()}
          disabled={!idToken || connection?.status === "disconnected" || isRestricted}
        >
          <RefreshCw className="mr-2 size-4" />
          Refresh inbox
        </Button>
        <Button
          variant="ghost"
          onClick={() => void handleDisconnect()}
          disabled={!idToken || connection?.status === "disconnected" || isRestricted}
        >
          Disconnect
        </Button>
      </div>

      {connection ? (
        <Card>
          <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Mailbox</p>
              <p className="mt-2 text-sm text-foreground">{connection.accountEmail ?? "Unknown Gmail account"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Watch status</p>
              <p className="mt-2 text-sm text-foreground">
                {connection.watchStatus ?? "Not configured"}
                {connection.watchExpiration ? ` - expires ${new Date(connection.watchExpiration).toLocaleString()}` : ""}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Sync health</p>
              <p className="mt-2 text-sm text-foreground">
                {connection.fullResyncRequired
                  ? "Manual catch-up required"
                  : connection.lastDeltaSyncedAt
                    ? `Delta sync ${new Date(connection.lastDeltaSyncedAt).toLocaleString()}`
                    : "Waiting for first sync event"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Guidance</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {isRestricted
                  ? "This Gmail mailbox is owner-only. Workspace members can see connection status, but only the connector can open mailbox content or run Gmail actions."
                  : connection.watchStatus === "active"
                    ? "Push sync is active. Manual refresh is still available for bounded catch-up."
                    : connection.fullResyncRequired
                      ? "OAuth is connected, but Gmail watch needs attention and history expired. Use Refresh inbox to rebuild cached Gmail context."
                      : "OAuth is connected, but Gmail push sync still needs attention. Manual refresh remains available."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)_360px]">
        <Card className="h-[72vh] overflow-hidden">
          <CardContent className="flex h-full flex-col gap-4 p-4">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search inbox threads..."
              disabled={isRestricted}
            />
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {isRestricted ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                  Gmail thread content is restricted to the user who connected this mailbox.
                </div>
              ) : list.length ? (
                list.map((thread) => (
                  <button
                    key={thread.threadId}
                    type="button"
                    onClick={() => setSelectedThreadId(thread.threadId)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                      selectedThreadId === thread.threadId
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/30 hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="line-clamp-1 text-sm font-semibold">{thread.subject}</p>
                      {thread.unread ? <StatusPill status="unread" /> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{thread.from}</p>
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{thread.snippet}</p>
                    <p className="mt-3 text-[11px] text-muted-foreground">
                      {thread.lastMessageAt ? new Date(thread.lastMessageAt).toLocaleString() : "Unknown time"}
                    </p>
                  </button>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                  No Gmail threads yet. Connect and refresh Gmail to start bringing in email context.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="h-[72vh] overflow-hidden">
          <CardContent className="flex h-full flex-col gap-4 p-5">
            {!selectedThreadId ? (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                Select a Gmail thread to open it here.
              </div>
            ) : isRestricted ? (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                Only the Gmail connection owner can open raw thread content here.
              </div>
            ) : threadQuery.isLoading && !selectedThread ? (
              <LoadingState label="Loading thread..." rows={4} />
            ) : threadQuery.error ? (
              <ErrorState
                message={getFriendlyErrorMessage(threadQuery.error, "We couldn't load that thread.")}
                onRetry={() => void threadQuery.refetch()}
              />
            ) : selectedThread ? (
              <>
                <div className="border-b border-border pb-4">
                  <div className="flex items-center gap-3">
                    <Mail className="size-5 text-primary" />
                    <div>
                      <h2 className="text-lg font-semibold">{selectedThread.subject}</h2>
                      <p className="text-sm text-muted-foreground">{selectedThread.participants.join(", ")}</p>
                    </div>
                  </div>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                  {selectedThread.messages.map((message: GmailItemDetailResponse["detail"]["messages"][number]) => (
                    <div key={message.id} className="rounded-xl border border-border bg-background px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{message.from}</p>
                          <p className="text-xs text-muted-foreground">
                            To {message.to.join(", ") || "Unknown"}
                            {message.cc.length ? ` - Cc ${message.cc.join(", ")}` : ""}
                          </p>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{message.sentAt ?? "Unknown time"}</p>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                        {message.bodyText || message.snippet}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card className="h-[72vh] overflow-hidden">
          <CardContent className="flex h-full flex-col gap-4 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">AI actions</p>
              <h3 className="mt-2 text-lg font-semibold">Act on the selected thread</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                The selected Gmail thread stays local page context for these actions and carries into Command Center while it remains selected.
              </p>
            </div>

            <div className="grid gap-2">
              <Button
                variant="outline"
                disabled={!selectedThreadId || isRestricted}
                onClick={() =>
                  void handleAction(
                    "Thread summary",
                    "summarizeThread",
                    { threadId: selectedThreadId },
                    (result: { summary: string; keyPoints: string[] }) =>
                      `${result.summary}\n\nKey points:\n- ${result.keyPoints.join("\n- ")}`,
                  )
                }
              >
                <Sparkles className="mr-2 size-4" />
                Summarize thread
              </Button>
              <Button
                variant="outline"
                disabled={!selectedThreadId || isRestricted}
                onClick={() =>
                  void handleAction(
                    "Action items",
                    "extractActionItems",
                    { threadId: selectedThreadId },
                    (result: { summary: string; actionItems: Array<{ owner: string; task: string; dueHint?: string }> }) =>
                      `${result.summary}\n\nAction items:\n- ${result.actionItems.map((item) => `${item.owner}: ${item.task}${item.dueHint ? ` (${item.dueHint})` : ""}`).join("\n- ")}`,
                  )
                }
              >
                <Link2 className="mr-2 size-4" />
                Extract action items
              </Button>
              <Button
                variant="outline"
                disabled={!selectedThreadId || isRestricted}
                onClick={() =>
                  void handleAction(
                    "Draft reply",
                    "draftReply",
                    { threadId: selectedThreadId, tone: "clear and professional" },
                    (result: { subject: string; body: string; rationale: string }) =>
                      `Subject: ${result.subject}\n\n${result.body}\n\nRationale: ${result.rationale}`,
                  )
                }
              >
                <Send className="mr-2 size-4" />
                Draft reply
              </Button>
              <Button
                variant="outline"
                disabled={!selectedThreadId || isRestricted}
                onClick={() =>
                  void handleAction(
                    "Prepare send approval",
                    "prepareSendApproval",
                    {
                      threadId: selectedThreadId,
                      to: recipientCandidates
                        .split(",")
                        .map((value: string) => value.trim())
                        .filter(Boolean),
                    },
                    (result: { approvalId: string; subject: string; body: string }) =>
                      `Approval ${result.approvalId} created.\n\nSubject: ${result.subject}\n\n${result.body}`,
                  )
                }
              >
                <Send className="mr-2 size-4" />
                Prepare send approval
              </Button>
              <Button
                variant="outline"
                disabled={!selectedThreadId || isRestricted}
                onClick={() =>
                  void handleAction(
                    "Save summary",
                    "saveThreadSummary",
                    { threadId: selectedThreadId },
                    (result: { artifactId: string; title: string }) =>
                      `Artifact ${result.artifactId} saved.\n\n${result.title}`,
                  )
                }
              >
                <FileText className="mr-2 size-4" />
                Save summary to Library
              </Button>
              <Button
                variant="outline"
                disabled={!selectedThreadId || isRestricted}
                onClick={() =>
                  void handleAction(
                    "Follow-up workflow",
                    "createFollowUpWorkflow",
                    { threadId: selectedThreadId },
                    (result: { workflowId: string; name: string }) =>
                      `Workflow ${result.workflowId} created.\n\n${result.name}`,
                  )
                }
              >
                <Workflow className="mr-2 size-4" />
                Create follow-up workflow
              </Button>
              <Button variant="outline" onClick={() => void handleAnalyzeStyle()} disabled={!idToken || isRestricted}>
                <Sparkles className="mr-2 size-4" />
                Analyze writing style
              </Button>
              <Button variant="ghost" onClick={() => void handleResetStyle()} disabled={!idToken || !styleProfile || isRestricted}>
                Reset writing style
              </Button>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-sm font-semibold">Writing style profile</p>
              {styleProfile ? (
                <div className="mt-2 space-y-2 text-sm text-muted-foreground">
                  <p>{styleProfile.summary}</p>
                  <p>Tone: {styleProfile.tone}</p>
                  <p>Formality: {styleProfile.formality}</p>
                  <p>Greeting: {styleProfile.greetingStyle}</p>
                  <p>Sign-off: {styleProfile.signOffStyle}</p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No Gmail writing style profile yet. Analyze sent mail to make reply drafts sound more like you.
                </p>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-muted/20 p-4">
              {actionState ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">{actionState.title}</p>
                  <pre className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{actionState.body}</pre>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {isRestricted
                    ? "Only the Gmail connection owner can run Gmail actions from this workspace."
                    : "Select a thread, then run an AI action here. Gideon will keep that thread as the immediate context source."}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
