"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CheckSquare,
  Contact,
  DollarSign,
  FileText,
  RefreshCw,
  Sparkles,
  Workflow,
  LinkIcon,
  Database,
  TrendingUp,
} from "lucide-react";

import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/ToastProvider";
import { useAuth } from "@/hooks/useAuth";
import { useIntegrationItemQuery, useIntegrationWorkspaceQuery } from "@/hooks/useGideonQueries";
import { clearActiveIntegrationContext, writeActiveIntegrationContext } from "@/lib/activeIntegrationContext";
import { getFriendlyErrorMessage } from "@/lib/product";
import {
  connectIntegration,
  disconnectIntegration,
  runIntegrationAction,
  syncIntegration,
  type HubSpotItemDetailResponse,
  type HubSpotModule,
  type HubSpotRecordDetail,
  type HubSpotRecordListItem,
  type HubSpotRelatedRecord,
} from "@/services/integrations";

type HubSpotWorkspacePageProps = {
  provider: string;
};

const modules: Array<{ id: HubSpotModule; label: string; icon: typeof Contact }> = [
  { id: "contacts", label: "Contacts", icon: Contact },
  { id: "companies", label: "Companies", icon: Building2 },
  { id: "deals", label: "Deals", icon: DollarSign },
  { id: "notes", label: "Notes", icon: FileText },
  { id: "tasks", label: "Tasks", icon: CheckSquare },
];

function recordDisplayTitle(module: HubSpotModule, record?: HubSpotRecordDetail | null) {
  if (!record) return "Selected record";
  if (record.title) return record.title;
  if (module === "contacts") {
    return `${record.properties?.["firstname"] ?? ""} ${record.properties?.["lastname"] ?? ""}`.trim()
      || String(record.properties?.["email"] ?? "Selected contact");
  }
  if (module === "companies") {
    return String(record.properties?.["name"] ?? record.properties?.["domain"] ?? "Selected company");
  }
  if (module === "deals") {
    return String(record.properties?.["dealname"] ?? "Selected deal");
  }
  if (module === "notes") {
    return String(record.properties?.["hs_note_body"] ?? "Selected note").slice(0, 72);
  }
  return String(record.properties?.["hs_task_subject"] ?? record.properties?.["hs_task_body"] ?? "Selected task");
}

function RelatedSection({ title, records }: { title: string; records?: HubSpotRelatedRecord[] }) {
  if (!records?.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {records.map((record) => (
        <div key={`${record.module}-${record.id}`} className="rounded-xl border border-border/60 bg-background px-3 py-2.5">
          <p className="text-sm font-medium text-foreground">{record.title}</p>
          {record.subtitle ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{record.subtitle}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RecordAvatar({ title }: { title: string }) {
  const initial = title.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
      {initial}
    </div>
  );
}

export function HubSpotWorkspacePage({ provider }: HubSpotWorkspacePageProps) {
  const { idToken } = useAuth();
  const { pushToast } = useToast();
  const [module, setModule] = useState<HubSpotModule>("contacts");
  const [query, setQuery] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [actionState, setActionState] = useState<{ loading: boolean; title: string; body: string } | null>(null);
  const workspaceQuery = useIntegrationWorkspaceQuery(provider, { query, module });
  const connection = workspaceQuery.data?.connection;
  const list = (workspaceQuery.data?.list ?? []) as HubSpotRecordListItem[];
  const recordQuery = useIntegrationItemQuery(provider, selectedRecordId, { module, enabled: Boolean(selectedRecordId) });
  const record = (recordQuery.data as HubSpotItemDetailResponse | undefined)?.detail ?? null;
  const selectedContextBundleId = (recordQuery.data as HubSpotItemDetailResponse | undefined)?.contextBundleId ?? null;
  const isDisconnected = connection?.status === "disconnected" || !connection;
  const needsReconnect = connection?.status === "reconnect_needed" || connection?.status === "expired";
  const hasProviderError = connection?.status === "error";
  const selectedTitle = useMemo(() => recordDisplayTitle(module, record), [module, record]);
  const supportsRecordWrites = module === "contacts" || module === "companies" || module === "deals";
  const supportsTaskUpdate = module === "tasks";
  const currentModule = modules.find((m) => m.id === module);

  useEffect(() => {
    if (isDisconnected || needsReconnect || hasProviderError || !selectedRecordId || !selectedContextBundleId || !record) {
      clearActiveIntegrationContext("hubspot");
      return;
    }
    writeActiveIntegrationContext({
      provider: "hubspot",
      itemId: selectedRecordId,
      title: selectedTitle,
      subtitle: module,
      contextBundleId: selectedContextBundleId,
    });
  }, [hasProviderError, isDisconnected, module, needsReconnect, record, selectedContextBundleId, selectedRecordId, selectedTitle]);

  async function handleConnect() {
    if (!idToken) return;
    const result = await connectIntegration(idToken, provider);
    window.location.href = result.authUrl;
  }

  async function handleSync() {
    if (!idToken) return;
    await syncIntegration(idToken, provider);
    pushToast({ title: "CRM syncing", description: "Records are refreshing in the background.", tone: "success" });
    void workspaceQuery.refetch();
  }

  async function handleDisconnect() {
    if (!idToken) return;
    await disconnectIntegration(idToken, provider);
    clearActiveIntegrationContext("hubspot");
    pushToast({ title: "HubSpot disconnected", tone: "success" });
    setSelectedRecordId(null);
    void workspaceQuery.refetch();
  }

  async function handleAction<T>(title: string, action: string, payload: Record<string, unknown>, format: (result: T) => string) {
    if (!idToken) return;
    setActionState({ loading: true, title, body: "Working…" });
    try {
      const result = await runIntegrationAction<T>(idToken, provider, action, payload);
      setActionState({ loading: false, title, body: format(result) });
      void workspaceQuery.refetch();
    } catch (error) {
      setActionState({ loading: false, title, body: getFriendlyErrorMessage(error, "This action needs attention.") });
    }
  }

  if (workspaceQuery.isLoading && !workspaceQuery.data) {
    return <LoadingState label="Loading HubSpot…" rows={4} />;
  }

  if (workspaceQuery.error) {
    return <ErrorState message={getFriendlyErrorMessage(workspaceQuery.error, "We couldn't open HubSpot right now.")} onRetry={() => void workspaceQuery.refetch()} />;
  }

  return (
    <section className="flex flex-col gap-5">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2 text-[13px] text-muted-foreground">
            <Link href="/integrations" className="transition-colors hover:text-foreground">Integrations</Link>
            <span className="text-border/60">/</span>
            <Link href={`/integrations/${provider}`} className="transition-colors hover:text-foreground">{provider === "hubspot" ? "HubSpot" : "Integration"}</Link>
            <span className="text-border/60">/</span>
            <span className="font-medium text-foreground">Workspace</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">HubSpot</h1>
          {connection?.accountEmail ? (
            <p className="mt-1 text-sm text-muted-foreground">{connection.accountEmail}</p>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-3">
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {connection ? <StatusPill status={connection.status} /> : null}
            {isDisconnected || needsReconnect ? (
              <Button size="sm" onClick={() => void handleConnect()} disabled={!idToken}>
                <LinkIcon className="mr-2 size-3.5" />
                Connect HubSpot
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => void handleSync()} disabled={!idToken}>
                  <RefreshCw className="mr-2 size-3.5" />
                  Refresh
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void handleDisconnect()} disabled={!idToken}>
                  Disconnect
                </Button>
              </>
            )}
          </div>
          
          {/* Mock AI Tools */}
          <div className="flex items-center gap-2">
            <div className="group relative flex cursor-not-allowed items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm transition-colors hover:border-border hover:bg-muted/50">
              <Sparkles className="size-3 text-amber-500" />
              Lead Scorer
              <div className="pointer-events-none absolute -bottom-7 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-[10px] font-medium text-background opacity-0 shadow-xl transition-all duration-200 group-hover:-translate-y-1 group-hover:opacity-100">
                Coming soon
              </div>
            </div>

            <div className="group relative flex cursor-not-allowed items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm transition-colors hover:border-border hover:bg-muted/50">
              <Workflow className="size-3 text-blue-500" />
              Auto-Routing
              <div className="pointer-events-none absolute -bottom-7 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-[10px] font-medium text-background opacity-0 shadow-xl transition-all duration-200 group-hover:-translate-y-1 group-hover:opacity-100">
                Coming soon
              </div>
            </div>

            <div className="group relative flex cursor-not-allowed items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm transition-colors hover:border-border hover:bg-muted/50">
              <Database className="size-3 text-emerald-500" />
              Data Enricher
              <div className="pointer-events-none absolute -bottom-7 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-[10px] font-medium text-background opacity-0 shadow-xl transition-all duration-200 group-hover:-translate-y-1 group-hover:opacity-100">
                Coming soon
              </div>
            </div>

            <div className="group relative flex cursor-not-allowed items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm transition-colors hover:border-border hover:bg-muted/50">
              <TrendingUp className="size-3 text-purple-500" />
              Deal Predictor
              <div className="pointer-events-none absolute -bottom-7 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-[10px] font-medium text-background opacity-0 shadow-xl transition-all duration-200 group-hover:-translate-y-1 group-hover:opacity-100">
                Coming soon
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Workspace shell ─────────────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[200px_360px_minmax(0,1fr)] xl:h-[calc(100vh-10rem)]">

        {/* Left — Object nav */}
        <Card className="overflow-hidden flex flex-col">
          <CardContent className="p-3 flex-1 overflow-y-auto">
            <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Objects</p>
            <div className="mt-1 space-y-0.5">
              {modules.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { setModule(item.id); setSelectedRecordId(null); }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                      module === item.id
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <Icon className="size-4 shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Center — List */}
        <Card className="overflow-hidden flex flex-col">
          <CardContent className="p-4 flex flex-col h-full overflow-hidden">
            <div className="flex flex-col gap-3 shrink-0">
              <h2 className="text-base font-semibold text-foreground">{currentModule?.label}</h2>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${module}…`}
                disabled={isDisconnected || needsReconnect}
                className="w-full"
              />
            </div>

            <div className="mt-4 space-y-1.5 flex-1 overflow-y-auto pr-1">
              {isDisconnected ? (
                <div className="flex h-full min-h-[120px] items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground text-center px-4">
                  Connect HubSpot to browse records
                </div>
              ) : needsReconnect ? (
                <div className="flex h-full min-h-[120px] items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground text-center px-4">
                  {connection?.reconnectReason ?? "Reconnect HubSpot to continue"}
                </div>
              ) : list.length ? (
                list.map((recordItem) => (
                  <button
                    key={recordItem.id}
                    type="button"
                    onClick={() => setSelectedRecordId(recordItem.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                      selectedRecordId === recordItem.id
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:border-border hover:bg-muted/40"
                    }`}
                  >
                    <RecordAvatar title={recordItem.title} />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-sm font-medium text-foreground">{recordItem.title}</p>
                      {recordItem.subtitle ? (
                        <p className="line-clamp-1 text-xs text-muted-foreground">{recordItem.subtitle}</p>
                      ) : null}
                    </div>
                  </button>
                ))
              ) : (
                <div className="flex h-full min-h-[120px] items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                  No {module} found
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right — Detail */}
        <Card className="overflow-hidden flex flex-col">
          <CardContent className="p-5 flex-1 overflow-y-auto">
            {!selectedRecordId ? (
              <div className="flex h-full min-h-[280px] items-center justify-center text-sm text-muted-foreground">
                Select a record from the list to view details
              </div>
            ) : recordQuery.isLoading && !record ? (
              <LoadingState label="Loading…" rows={4} />
            ) : recordQuery.error ? (
              <ErrorState message={getFriendlyErrorMessage(recordQuery.error, "Couldn't load this record.")} onRetry={() => void recordQuery.refetch()} />
            ) : record ? (
              <div className="space-y-6">
                {/* Record header */}
                <div className="border-b border-border/60 pb-5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-semibold text-foreground">{selectedTitle}</h3>
                    <StatusPill status="connected" />
                  </div>
                  {record.summary ? (
                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{record.summary}</p>
                  ) : null}
                </div>

                {/* Properties + associations */}
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
                  <div className="rounded-xl border border-border/60 bg-background/60 p-5">
                    <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Properties</p>
                    <div className="divide-y divide-border/50">
                      {Object.entries(record.properties ?? {}).map(([key, value]) => (
                        <div key={key} className="flex items-start gap-3 py-2.5">
                          <p className="w-[140px] shrink-0 text-xs font-medium uppercase tracking-wider text-muted-foreground mt-0.5">{key}</p>
                          <p className="min-w-0 flex-1 break-words text-sm text-foreground font-medium">
                            {value === null || value === undefined || value === "" ? "—" : String(value)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-5">
                    <RelatedSection title="Associated companies" records={record.associations?.companies} />
                    <RelatedSection title="Associated contacts" records={record.associations?.contacts} />
                    <RelatedSection title="Associated deals" records={record.associations?.deals} />
                    <RelatedSection title="Recent notes" records={record.relatedNotes} />
                    <RelatedSection title="Recent tasks" records={record.relatedTasks} />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2.5 border-t border-border/60 pt-5">
                  <Button size="sm" variant="outline" disabled={needsReconnect || hasProviderError}
                    onClick={() => void handleAction("Summary", "summarizeRecord", { module, recordId: selectedRecordId },
                      (r: { summary: string; keyPoints: string[] }) => `${r.summary}\n\n${r.keyPoints.map(p => `• ${p}`).join("\n")}`)}>
                    <Sparkles className="mr-1.5 size-3.5" /> Summarize
                  </Button>
                  {supportsRecordWrites ? (
                    <Button size="sm" variant="outline" disabled={needsReconnect || hasProviderError}
                      onClick={() => void handleAction("Follow-up", "draftFollowUp", { module, recordId: selectedRecordId },
                        (r: { subject: string; body: string }) => `${r.subject}\n\n${r.body}`)}>
                      <Contact className="mr-1.5 size-3.5" /> Follow-up
                    </Button>
                  ) : null}
                  {supportsRecordWrites ? (
                    <Button size="sm" variant="outline" disabled={needsReconnect || hasProviderError}
                      onClick={() => void handleAction("Add note", "prepareNoteApproval", { module, recordId: selectedRecordId, body: `Gideon note for ${selectedTitle}` },
                        (r: { approvalId: string }) => `Approval ${r.approvalId} created`)}>
                      <FileText className="mr-1.5 size-3.5" /> Add note
                    </Button>
                  ) : null}
                  {supportsRecordWrites ? (
                    <Button size="sm" variant="outline" disabled={needsReconnect || hasProviderError}
                      onClick={() => void handleAction("Create task", "prepareTaskCreateApproval", { module, recordId: selectedRecordId, subject: `Follow up on ${selectedTitle}` },
                        (r: { approvalId: string }) => `Approval ${r.approvalId} created`)}>
                      <CheckSquare className="mr-1.5 size-3.5" /> Create task
                    </Button>
                  ) : null}
                  {supportsTaskUpdate ? (
                    <Button size="sm" variant="outline" disabled={needsReconnect || hasProviderError}
                      onClick={() => void handleAction("Update task", "prepareTaskUpdateApproval", { recordId: selectedRecordId, updates: { hs_task_status: "COMPLETED" } },
                        (r: { approvalId: string }) => `Approval ${r.approvalId} created`)}>
                      <CheckSquare className="mr-1.5 size-3.5" /> Mark done
                    </Button>
                  ) : null}
                  {supportsRecordWrites ? (
                    <Button size="sm" variant="outline" disabled={needsReconnect || hasProviderError}
                      onClick={() => void handleAction("Create workflow", "createRecordWorkflow", { module, recordId: selectedRecordId },
                        (r: { workflowId: string; name: string }) => `Workflow created: ${r.name}`)}>
                      <Workflow className="mr-1.5 size-3.5" /> Workflow
                    </Button>
                  ) : null}
                </div>

                {/* Action output inline */}
                {actionState ? (
                  <div className="mt-4 rounded-xl border border-border/60 bg-muted/30 p-4">
                    <p className="text-xs font-semibold text-foreground uppercase tracking-widest">{actionState.title}</p>
                    <pre className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground font-sans">{actionState.body}</pre>
                  </div>
                ) : null}

              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
