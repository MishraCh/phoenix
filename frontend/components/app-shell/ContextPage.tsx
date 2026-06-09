"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  Brain,
  Building2,
  CheckCircle,
  ChevronDown,
  Clock,
  Database,
  Loader2,
  Plus,
  RefreshCw,
  Sliders,
  Star,
  Trash2,
  X,
  Zap,
} from "lucide-react";

import { ContextHealthBadge } from "@/components/ui/ContextHealthBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { SourceChips } from "@/components/ui/SourceChips";
import { useToast } from "@/components/ui/ToastProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import {
  gideonQueryKeys,
  useArtifactsQuery,
  useContextBundlesQuery,
  useIntegrationsQuery,
  useMemoryQuery,
  useWorkflowsQuery,
  useWorkspaceDetailQuery,
} from "@/hooks/useGideonQueries";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getFriendlyErrorMessage } from "@/lib/product";
import { buildContextBundle, type ContextBundle } from "@/services/context";
import {
  createMemoryNode,
  deleteMemoryNode,
  memoryTypeLabels,
  updateMemoryNode,
  type MemoryNode,
  type MemoryNodeType,
} from "@/services/memory";
import { updateWorkspaceSettings } from "@/services/workspaces";
import { ProductHeader } from "./ProductHeader";
import { SummaryRow } from "./ProductPrimitives";

type Tab = "memory" | "sources" | "context";

const KNOWN_INTEGRATIONS = [
  { provider: "google", label: "Google Workspace", unlocks: "Gmail, Calendar, Drive" },
  { provider: "microsoft", label: "Microsoft 365", unlocks: "Outlook, Teams, OneDrive" },
  { provider: "hubspot", label: "HubSpot", unlocks: "CRM contacts, deals, pipelines" },
  { provider: "salesforce", label: "Salesforce", unlocks: "CRM records, deal tracking" },
  { provider: "slack", label: "Slack", unlocks: "Channel summaries, message drafting" },
  { provider: "notion", label: "Notion", unlocks: "Page read and write" },
] as const;

function typeColor(type: MemoryNode["type"]): string {
  return (
    ({
      fact: "bg-[hsl(var(--badge-running-bg))] text-primary border border-[hsl(var(--badge-running-border))]",
      preference: "bg-[#F5F0FF] text-purple-700 border border-purple-200",
      pattern:
        "bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))] border border-[hsl(var(--badge-warning-border))]",
      contact:
        "bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))] border border-[hsl(var(--badge-success-border))]",
      decision:
        "bg-[hsl(var(--badge-danger-bg))] text-[hsl(var(--badge-danger-text))] border border-[hsl(var(--badge-danger-border))]",
    } as Record<string, string>)[type] ?? "bg-muted text-muted-foreground border border-border"
  );
}

function formatBundleLabel(bundle: ContextBundle) {
  return bundle.purpose || bundle.key.replace(/[_:]/g, " ");
}

export function ContextPage() {
  const [tab, setTab] = useState<Tab>("memory");
  const [showArchived, setShowArchived] = useState(false);
  const [addingMemory, setAddingMemory] = useState(false);
  const [newMemoryType, setNewMemoryType] = useState<MemoryNodeType>("fact");
  const [newMemoryContent, setNewMemoryContent] = useState("");
  const [savingMemory, setSavingMemory] = useState(false);
  const [pendingMemory, setPendingMemory] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const { idToken } = useAuth();
  const { me, workspaces } = useWorkspace();
  const workspaceId = me?.defaultWorkspaceId ?? workspaces[0]?.id ?? null;

  const memoryQuery = useMemoryQuery();
  const contextQuery = useContextBundlesQuery();
  const integrationsQuery = useIntegrationsQuery();
  const workflowsQuery = useWorkflowsQuery();
  const artifactsQuery = useArtifactsQuery();
  const workspaceDetailQuery = useWorkspaceDetailQuery(workspaceId);
  const defaultContextBundleId = workspaceDetailQuery.data?.defaultContextBundleId ?? null;

  const allMemory = memoryQuery.data?.memory ?? [];
  const needsReview = allMemory.filter((n) => n.status === "needs_review");
  const active = allMemory.filter((n) => n.status === "active");
  const archived = allMemory.filter((n) => n.status === "archived");
  const integrations = integrationsQuery.data?.integrations ?? [];
  const bundles = contextQuery.data?.bundles ?? [];
  const workflowCount =
    workflowsQuery.data?.workflows.filter((w) => w.type !== "template").length ?? 0;
  const artifactCount = artifactsQuery.data?.artifacts.length ?? 0;
  const connectedCount = integrations.filter((i) => i.status === "connected").length;

  // ── Memory handlers ─────────────────────────────────────────────────────────

  async function handleConfirm(node: MemoryNode) {
    if (!idToken) return;
    setPendingMemory(node.id);
    try {
      await updateMemoryNode(idToken, node.id, { status: "active" });
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.memory(idToken) });
      pushToast({ title: "Memory confirmed", description: "Node is now active.", tone: "success" });
    } catch (err) {
      pushToast({ title: "Couldn't confirm", description: getFriendlyErrorMessage(err), tone: "error" });
    } finally {
      setPendingMemory(null);
    }
  }

  async function handleArchive(node: MemoryNode) {
    if (!idToken) return;
    setPendingMemory(node.id);
    try {
      await updateMemoryNode(idToken, node.id, { status: "archived" });
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.memory(idToken) });
      pushToast({ title: "Memory archived", tone: "success" });
    } catch (err) {
      pushToast({ title: "Couldn't archive", description: getFriendlyErrorMessage(err), tone: "error" });
    } finally {
      setPendingMemory(null);
    }
  }

  async function handleDelete(node: MemoryNode) {
    if (!idToken) return;
    setPendingMemory(node.id);
    try {
      await deleteMemoryNode(idToken, node.id);
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.memory(idToken) });
      pushToast({ title: "Memory deleted", tone: "success" });
    } catch (err) {
      pushToast({ title: "Couldn't delete", description: getFriendlyErrorMessage(err), tone: "error" });
    } finally {
      setPendingMemory(null);
    }
  }

  async function handleCreateMemory() {
    if (!idToken || !newMemoryContent.trim()) return;
    setSavingMemory(true);
    try {
      await createMemoryNode(idToken, { type: newMemoryType, content: newMemoryContent.trim() });
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.memory(idToken) });
      setNewMemoryContent("");
      setAddingMemory(false);
      pushToast({ title: "Memory saved", tone: "success" });
    } catch (err) {
      pushToast({ title: "Couldn't save", description: getFriendlyErrorMessage(err), tone: "error" });
    } finally {
      setSavingMemory(false);
    }
  }

  // ── Context bundle handlers ──────────────────────────────────────────────────

  async function handleSetDefault(bundleId: string) {
    if (!idToken || !workspaceId) return;
    const isCurrentDefault = defaultContextBundleId === bundleId;
    setSettingDefault(bundleId);
    try {
      await updateWorkspaceSettings(idToken, workspaceId, {
        defaultContextBundleId: isCurrentDefault ? null : bundleId,
      });
      await queryClient.invalidateQueries({
        queryKey: gideonQueryKeys.workspaceDetail(idToken, workspaceId),
      });
      pushToast({
        title: isCurrentDefault ? "Default cleared" : "Default set",
        description: isCurrentDefault
          ? "Commands will select context automatically."
          : "This bundle will be used by default in all commands.",
        tone: "success",
      });
    } catch (err) {
      pushToast({
        title: "Couldn't update default",
        description: getFriendlyErrorMessage(err),
        tone: "error",
      });
    } finally {
      setSettingDefault(null);
    }
  }

  async function handleBuildBundle() {
    if (!idToken) return;
    setRefreshing(true);
    try {
      const result = await buildContextBundle(idToken);
      pushToast({
        title: result.reused ? "Snapshot refreshed" : "Snapshot created",
        description: result.reused
          ? "Gideon reused the latest snapshot it already had."
          : "Gideon prepared a fresh snapshot for this workspace.",
        tone: "success",
      });
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.context(idToken) });
      await contextQuery.refetch();
    } catch (err) {
      pushToast({
        title: "Refresh failed",
        description: getFriendlyErrorMessage(err),
        tone: "error",
      });
    } finally {
      setRefreshing(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <section className="space-y-6">
      <ProductHeader
        eyebrow="Memory"
        title="Memory & Knowledge"
        meta={
          <SummaryRow
            className="md:grid-cols-4 xl:grid-cols-4"
            items={[
              {
                label: "Active memory",
                value: active.length,
                detail: "Facts and preferences Gideon can actively use.",
                icon: Brain,
                tone: active.length > 0 ? "primary" : "neutral",
              },
              {
                label: "Needs review",
                value: needsReview.length,
                detail: "New knowledge inferred from work that still needs human confirmation.",
                icon: Clock,
                tone: needsReview.length > 0 ? "warning" : "neutral",
              },
              {
                label: "Connected sources",
                value: connectedCount,
                detail: "Systems contributing context into this workspace.",
                icon: Database,
                tone: connectedCount > 0 ? "success" : "neutral",
              },
              {
                label: "Context bundles",
                value: bundles.length,
                detail: "Snapshots of curated knowledge Gideon can retrieve quickly.",
                icon: Sliders,
                tone: bundles.length > 0 ? "neutral" : "primary",
              },
            ]}
          />
        }
        description="What Gideon knows about your workspace — memory facts, connected sources, and session context."
        action={
          <Button onClick={handleBuildBundle} disabled={refreshing} variant="outline" size="sm">
            {refreshing ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            {refreshing ? "Refreshing…" : "Refresh snapshot"}
          </Button>
        }
      />

      {/* Tab strip */}
      <div className="flex gap-1 w-fit rounded-xl border border-border bg-muted/30 p-1">
        {(["memory", "sources", "context"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "memory" ? "Memory" : t === "sources" ? "Knowledge Sources" : "Context"}
          </button>
        ))}
      </div>

      {/* ── MEMORY TAB ──────────────────────────────────────────────────────── */}
      {tab === "memory" && (
        <div className="space-y-4">
          {/* Needs review */}
          {needsReview.length > 0 && (
            <Card className="border-[#F5A623]/30 bg-[#FFF8EC]/40">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Brain className="size-4 text-[#F5A623]" />
                    <p className="text-sm font-semibold">Needs review</p>
                    <Badge variant="secondary" className="h-5 rounded-full px-2 text-xs">
                      {needsReview.length}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">Learned from your sessions</p>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Gideon noticed these things while you were working. Confirm to keep them, or
                  dismiss if they&apos;re not accurate.
                </p>
                <div className="mt-4 space-y-2">
                  {needsReview.map((node) => (
                    <div
                      key={node.id}
                      className="flex items-start gap-3 rounded-2xl border border-[#F5A623]/40 bg-white p-3"
                    >
                      <span
                        className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeColor(node.type)}`}
                      >
                        {memoryTypeLabels[node.type]}
                      </span>
                      <p className="flex-1 text-sm leading-relaxed">{node.content}</p>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-[#00925A] hover:bg-[#E6FBF2]"
                          disabled={pendingMemory === node.id}
                          title="Confirm"
                          onClick={() => void handleConfirm(node)}
                        >
                          {pendingMemory === node.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <CheckCircle className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-muted-foreground hover:bg-muted"
                          disabled={pendingMemory === node.id}
                          title="Dismiss"
                          onClick={() => void handleDelete(node)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Active memory */}
          <Card className="border-primary/10 bg-gradient-to-b from-[#f8fbff] to-white transition-[border-color,box-shadow] duration-150 hover:border-primary/20 hover:shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Brain className="size-4 text-primary" />
                  <p className="text-sm font-semibold">What Gideon remembers</p>
                  {active.length > 0 && (
                    <Badge variant="secondary" className="h-5 rounded-full px-2 text-xs">
                      {active.length}
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-xs text-muted-foreground"
                  onClick={() => setAddingMemory((v) => !v)}
                >
                  <Plus className="size-3.5" />
                  Add memory
                </Button>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Facts about your team, decisions you&apos;ve made, and preferences Gideon has
                learned.
              </p>

              {/* Add memory form */}
              {addingMemory && (
                <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">New memory</p>
                  <select
                    value={newMemoryType}
                    onChange={(e) => setNewMemoryType(e.target.value as MemoryNodeType)}
                    className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  >
                    {(Object.keys(memoryTypeLabels) as MemoryNodeType[]).map((t) => (
                      <option key={t} value={t}>
                        {memoryTypeLabels[t]}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={newMemoryContent}
                    onChange={(e) => setNewMemoryContent(e.target.value)}
                    placeholder="E.g. We target mid-market B2B SaaS companies with 50–500 employees"
                    rows={2}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setAddingMemory(false);
                        setNewMemoryContent("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={!newMemoryContent.trim() || savingMemory}
                      onClick={() => void handleCreateMemory()}
                    >
                      {savingMemory && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                      Save
                    </Button>
                  </div>
                </div>
              )}

              <div className="mt-5">
                {memoryQuery.isLoading && !memoryQuery.data ? (
                  <LoadingState label="Loading memory..." rows={3} />
                ) : active.length > 0 ? (
                  <div className="ml-2 border-l-2 border-border/50 pl-4 space-y-2">
                    {active.map((node) => (
                      <div
                        key={node.id}
                        className="flex items-start gap-3 rounded-2xl border border-border bg-background p-3"
                      >
                        <span
                          className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeColor(node.type)}`}
                        >
                          {memoryTypeLabels[node.type]}
                        </span>
                        <p className="flex-1 text-sm leading-relaxed">{node.content}</p>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 text-muted-foreground hover:bg-muted"
                            disabled={pendingMemory === node.id}
                            title="Archive"
                            onClick={() => void handleArchive(node)}
                          >
                            {pendingMemory === node.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Archive className="size-3.5" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 text-destructive/60 hover:bg-destructive/5 hover:text-destructive"
                            disabled={pendingMemory === node.id}
                            title="Delete"
                            onClick={() => void handleDelete(node)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={<Brain className="size-6" />}
                    title="Nothing remembered yet"
                    description="As you work with Gideon, it will start building up knowledge about you, your team, and your preferences."
                  />
                )}
              </div>
            </CardContent>
          </Card>

          {/* Archived memory — collapsible */}
          {archived.length > 0 && (
            <Card className="border-border/60">
              <CardContent className="p-4">
                <button
                  className="flex w-full items-center justify-between text-sm text-muted-foreground"
                  onClick={() => setShowArchived((v) => !v)}
                >
                  <span className="flex items-center gap-2">
                    <Archive className="size-3.5" />
                    Archived ({archived.length})
                  </span>
                  <ChevronDown
                    className={`size-4 transition-transform ${showArchived ? "rotate-180" : ""}`}
                  />
                </button>
                {showArchived && (
                  <div className="mt-3 space-y-2">
                    {archived.map((node) => (
                      <div
                        key={node.id}
                        className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 p-3 opacity-60"
                      >
                        <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          {memoryTypeLabels[node.type]}
                        </span>
                        <p className="flex-1 text-sm leading-relaxed text-muted-foreground line-through">
                          {node.content}
                        </p>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-destructive/60 hover:bg-destructive/5 hover:text-destructive"
                          disabled={pendingMemory === node.id}
                          title="Delete permanently"
                          onClick={() => void handleDelete(node)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── KNOWLEDGE SOURCES TAB ────────────────────────────────────────────── */}
      {tab === "sources" && (
        <div className="space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                label: "Memory facts",
                value: active.length,
                icon: Brain,
                note:
                  needsReview.length > 0 ? `${needsReview.length} need review` : "all confirmed",
              },
              {
                label: "Library artifacts",
                value: artifactCount,
                icon: Database,
                note: "saved outputs",
              },
              {
                label: "Workflows",
                value: workflowCount,
                icon: Zap,
                note: "automations",
              },
            ].map(({ label, value, icon: Icon, note }) => (
              <Card key={label} className="border-border/60">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="size-4 text-primary" />
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                  <p className="text-2xl font-semibold tabular-nums">{value}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Integrations */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Zap className="size-4 text-primary" />
                  <p className="text-sm font-semibold">Integrations</p>
                  {connectedCount > 0 && (
                    <Badge variant="secondary" className="h-5 rounded-full px-2 text-xs">
                      {connectedCount} connected
                    </Badge>
                  )}
                </div>
                <a href="/integrations" className="text-xs font-medium text-primary hover:underline">
                  Manage →
                </a>
              </div>
              <div className="space-y-2">
                {integrationsQuery.isLoading ? (
                  <LoadingState label="Loading integrations..." rows={4} />
                ) : (
                  KNOWN_INTEGRATIONS.map(({ provider, label, unlocks }) => {
                    const found = integrations.find((i) => i.provider === provider);
                    const status = found?.status ?? "not_connected";
                    const isConnected = status === "connected";
                    const needsReconnect = status === "reconnect_needed";

                    return (
                      <div
                        key={provider}
                        className={`flex items-center justify-between rounded-xl border p-3 ${
                          isConnected
                            ? "border-[hsl(var(--badge-success-border))] bg-[hsl(var(--badge-success-bg))]"
                            : needsReconnect
                              ? "border-[hsl(var(--badge-warning-border))] bg-[hsl(var(--badge-warning-bg))]"
                              : "border-border/60 bg-muted/20"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p
                              className={`text-sm font-medium ${isConnected || needsReconnect ? "text-foreground" : "text-muted-foreground"}`}
                            >
                              {label}
                            </p>
                            {isConnected && (
                              <span className="inline-flex items-center rounded-full border border-[hsl(var(--badge-success-border))] bg-[hsl(var(--badge-success-bg))] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--badge-success-text))]">
                                Connected
                              </span>
                            )}
                            {needsReconnect && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--badge-warning-border))] bg-[hsl(var(--badge-warning-bg))] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--badge-warning-text))]">
                                <AlertTriangle className="size-2.5" />
                                Reconnect needed
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {isConnected
                              ? (found?.capabilities.join(", ") || unlocks)
                              : `Unlocks: ${unlocks}`}
                          </p>
                        </div>
                        {!isConnected && (
                          <a
                            href="/integrations"
                            className="ml-3 shrink-0 text-xs font-medium text-primary hover:underline"
                          >
                            {needsReconnect ? "Reconnect" : "Set up →"}
                          </a>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          {/* Context sources list */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="size-4 text-primary" />
                <p className="text-sm font-semibold">What Gideon draws on</p>
              </div>
              <div className="divide-y divide-border/40">
                {[
                  {
                    label: "Workspace memory",
                    desc: `${active.length} confirmed facts — preferences, decisions, patterns`,
                    available: active.length > 0,
                  },
                  {
                    label: "Library artifacts",
                    desc: `${artifactCount} saved research reports, drafts, and briefs`,
                    available: artifactCount > 0,
                  },
                  {
                    label: "Session summaries",
                    desc: "Compressed past session context, carried forward between conversations",
                    available: true,
                  },
                  {
                    label: "Semantic retrieval",
                    desc: "Relevant memory and artifacts retrieved per-query using vector search",
                    available: true,
                  },
                  {
                    label: "Connected integrations",
                    desc:
                      connectedCount > 0
                        ? `${connectedCount} source(s) active — providing real-time context`
                        : "No integrations connected yet",
                    available: connectedCount > 0,
                  },
                  {
                    label: "File upload",
                    desc: "Not yet available — coming soon",
                    available: false,
                  },
                ].map(({ label, desc, available }) => (
                  <div key={label} className="flex items-start gap-3 py-3">
                    <span
                      className={`mt-1 size-2 shrink-0 rounded-full ${available ? "bg-[hsl(var(--badge-success-text))]" : "bg-border"}`}
                    />
                    <div>
                      <p
                        className={`text-sm font-medium ${available ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        {label}
                      </p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── CONTEXT TAB (debug / advanced) ──────────────────────────────────── */}
      {tab === "context" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-muted/10 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Technical execution snapshots Gideon builds per-command. Useful for debugging context
              quality and understanding what sources were used.
            </p>
          </div>

          {/* Knowledge snapshots */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2">
                <Database className="size-4 text-primary" />
                <p className="text-sm font-semibold">Knowledge snapshots</p>
              </div>
              <p className="mt-2 mb-5 text-sm text-muted-foreground">
                Compressed snapshots Gideon builds from your connected tools and workspace activity.
              </p>
              <div className="space-y-3">
                {contextQuery.isLoading && !contextQuery.data ? (
                  <LoadingState label="Loading snapshots..." rows={3} />
                ) : bundles.length > 0 ? (
                  bundles.map((bundle) => {
                    const isDefault = bundle.id === defaultContextBundleId;
                    return (
                      <article
                        key={bundle.id}
                        className="rounded-container border border-border bg-background p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-semibold">{formatBundleLabel(bundle)}</p>
                              {isDefault && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                  <Star className="size-3" />
                                  Default
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              Updated {new Date(bundle.updatedAt).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <ContextHealthBadge freshness={bundle.freshness} />
                            <Button
                              size="sm"
                              variant={isDefault ? "outline" : "secondary"}
                              disabled={settingDefault === bundle.id}
                              onClick={() => void handleSetDefault(bundle.id)}
                            >
                              <Star className="mr-1 size-3" />
                              {isDefault ? "Clear default" : "Set default"}
                            </Button>
                          </div>
                        </div>
                        <div className="mt-4">
                          <SourceChips sources={bundle.sourceRefs} />
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <EmptyState
                    icon={<Database className="size-6" />}
                    title="No snapshots yet"
                    description="Connect your tools or use Gideon a few times — it will build knowledge snapshots automatically."
                  />
                )}
              </div>
            </CardContent>
          </Card>

          {/* Company profile */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2">
                <Building2 className="size-4 text-primary" />
                <p className="text-sm font-semibold">Company profile</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Your company name, focus areas, and goals — so Gideon&apos;s responses stay
                on-brand.
              </p>
              <div className="mt-5">
                <EmptyState
                  title="No company profile yet"
                  description="Add it from Settings to help Gideon understand your business context."
                />
              </div>
            </CardContent>
          </Card>

          {/* Preferences */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2">
                <Sliders className="size-4 text-primary" />
                <p className="text-sm font-semibold">Your preferences</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Response tone, working style, and communication preferences Gideon picks up over
                time.
              </p>
              <div className="mt-5">
                <EmptyState
                  title="No preferences yet"
                  description="Gideon learns these as you work, or you can set them explicitly in Settings."
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}
