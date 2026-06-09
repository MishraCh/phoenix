"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Activity,
  AlertCircle,
  BarChart2,
  Bell,
  BookOpen,
  Bot,
  Briefcase,
  CheckCircle2,
  ExternalLink,
  FileText,
  GitBranch,
  Globe,
  Layers,
  Mail,
  Settings2,
  Target,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";

import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusPill } from "@/components/ui/StatusPill";
import { useToast } from "@/components/ui/ToastProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { gideonQueryKeys, useAgentsQuery } from "@/hooks/useGideonQueries";
import { cn } from "@/lib/utils";
import { getFriendlyErrorMessage } from "@/lib/product";
import { fallbackAgents, updateAgentConfig } from "@/services/agents";

import { ProductHeader } from "./ProductHeader";
import { SummaryRow } from "./ProductPrimitives";

// ── Metadata (mirrors AgentsPage) ────────────────────────────────────────────

const agentMeta: Record<
  string,
  {
    icon: React.ElementType;
    desc: string;
    capabilities: string[];
    integrations: string[];
    instructionPlaceholder: string;
    color: string;
  }
> = {
  executive: {
    icon: Briefcase,
    desc: "Priorities, briefings, meeting prep, and operating rhythm support.",
    capabilities: ["Web research", "Save artifacts", "Draft workflows", "Notifications"],
    integrations: ["Calendar", "Email"],
    instructionPlaceholder:
      "e.g. Always flag items that need legal review. Use our OKR framework when summarising priorities.",
    color: "bg-[hsl(var(--badge-running-bg))] text-primary border-[hsl(var(--badge-running-border))]",
  },
  sales: {
    icon: Target,
    desc: "Lead follow-up, CRM context, drafts, and pipeline nudges.",
    capabilities: ["Draft emails", "CRM leads", "Web research", "Save artifacts"],
    integrations: ["CRM", "Email"],
    instructionPlaceholder:
      "e.g. Our CRM is HubSpot. Never send outbound without an approval step. Deal stages: Prospect → Qualified → Proposal.",
    color: "bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))] border-[hsl(var(--badge-success-border))]",
  },
  research: {
    icon: BookOpen,
    desc: "Company, person, market, and public web research.",
    capabilities: ["Deep web research", "URL extraction", "Structured data", "Save artifacts"],
    integrations: ["Web"],
    instructionPlaceholder:
      "e.g. Always cite sources. Prefer recent results (last 12 months). Summarise in bullet points with a 3-line executive summary at the top.",
    color: "bg-[hsl(221_100%_96%)] text-[hsl(221_73%_41%)] border-[hsl(221_73%_78%)]",
  },
  operations: {
    icon: Activity,
    desc: "Workflow hygiene, open loops, process checks, and internal reminders.",
    capabilities: ["Draft workflows", "Notifications", "Web research", "Save artifacts"],
    integrations: [],
    instructionPlaceholder:
      "e.g. We follow a weekly ops rhythm on Mondays. Escalate anything that blocks more than one team.",
    color: "bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))] border-[hsl(var(--badge-warning-border))]",
  },
  customer: {
    icon: Users,
    desc: "Customer escalations, account context, open loops, and response drafts.",
    capabilities: ["Draft emails", "Notifications", "Web research", "Save artifacts"],
    integrations: ["Email"],
    instructionPlaceholder:
      "e.g. Our SLA is 4 hours for tier-1 customers. Always propose a resolution before escalating.",
    color: "bg-[hsl(var(--badge-danger-bg))] text-[hsl(var(--badge-danger-text))] border-[hsl(var(--badge-danger-border))]",
  },
  recruiting: {
    icon: UserPlus,
    desc: "Candidate context, interview prep, follow-ups, and recruiting open loops.",
    capabilities: ["Draft emails", "Draft workflows", "Web research", "Save artifacts"],
    integrations: ["Calendar", "Email"],
    instructionPlaceholder:
      "e.g. We use a 3-stage process: screen → technical → values. Always include a personalised note in outreach drafts.",
    color: "bg-[hsl(260_60%_96%)] text-[hsl(260_60%_40%)] border-[hsl(260_40%_80%)]",
  },
};

const capabilityIcons: Record<string, React.ElementType> = {
  "Web research": Globe,
  "Deep web research": Globe,
  "URL extraction": Globe,
  "Structured data": Layers,
  "Save artifacts": FileText,
  "Draft workflows": GitBranch,
  Notifications: Bell,
  "Draft emails": Mail,
  "CRM leads": BarChart2,
};

const integrationIcons: Record<string, React.ElementType> = {
  Calendar: Zap,
  Email: Mail,
  CRM: BarChart2,
  Web: Globe,
};

// ── Main component ────────────────────────────────────────────────────────────

type AgentDetailPageProps = {
  agentId: string;
};

export function AgentDetailPage({ agentId }: AgentDetailPageProps) {
  const { idToken } = useAuth();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const agentsQuery = useAgentsQuery();

  const isRealData = Boolean(agentsQuery.data);
  const agents = agentsQuery.data?.agents.length ? agentsQuery.data.agents : fallbackAgents;
  const agent = agents.find((a) => a.id === agentId) ?? fallbackAgents.find((a) => a.id === agentId) ?? fallbackAgents[0];

  const loading = agentsQuery.isLoading && !agentsQuery.data;
  const queryError = agentsQuery.error
    ? getFriendlyErrorMessage(agentsQuery.error, "We couldn't load this assistant.")
    : null;

  const [draft, setDraft] = useState(agent?.systemPromptAddition ?? "");
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    setDraft(agent?.systemPromptAddition ?? "");
  }, [agent?.id, agent?.systemPromptAddition]);

  const meta = agentMeta[agent?.type ?? ""] ?? {
    icon: Bot,
    desc: agent?.description ?? "",
    capabilities: [],
    integrations: [],
    instructionPlaceholder: "Add custom instructions for this agent…",
    color: "bg-[hsl(var(--badge-running-bg))] text-primary border-[hsl(var(--badge-running-border))]",
  };

  const AgentIcon = meta.icon;
  const isActive = agent?.status === "active";
  const isDirty = draft !== (agent?.systemPromptAddition ?? "");
  const MAX_CHARS = 2000;

  async function handleSaveInstructions() {
    if (!idToken || !isRealData || !agent) return;
    setSaving(true);
    try {
      await updateAgentConfig(idToken, agent.id, { systemPromptAddition: draft || null });
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.agents(idToken) });
      pushToast({ title: "Instructions saved", tone: "success" });
    } catch (err) {
      pushToast({
        title: "Couldn't save instructions",
        description: getFriendlyErrorMessage(err, "Try again in a moment."),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle() {
    if (!isRealData || !agent) return;
    const newStatus = isActive ? "disabled" : "active";
    setToggling(true);
    try {
      await updateAgentConfig(idToken!, agent.id, { status: newStatus });
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.agents(idToken!) });
      pushToast({
        title: isActive ? "Assistant disabled" : "Assistant activated",
        tone: isActive ? "default" : "success",
      });
    } catch (err) {
      pushToast({
        title: "Couldn't update assistant",
        description: getFriendlyErrorMessage(err, "Try again in a moment."),
        tone: "error",
      });
    } finally {
      setToggling(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading assistant…" rows={3} />;
  }

  if (queryError) {
    return <ErrorState message={queryError} onRetry={() => void agentsQuery.refetch()} />;
  }

  return (
    <section className="space-y-6">
      {/* Back nav */}
      <Button asChild variant="ghost" className="px-0 text-muted-foreground hover:bg-transparent">
        <Link href="/agents">
          <ArrowLeft className="mr-2 size-4" />
          Back to assistants
        </Link>
      </Button>

      {/* Header */}
      <div className="flex items-start gap-5">
        <div className={cn("flex size-14 shrink-0 items-center justify-center rounded-2xl border shadow-sm", meta.color)}>
          <AgentIcon className="size-6" />
        </div>
        <ProductHeader
          eyebrow="Assistant"
          title={agent?.name ?? "Assistant"}
          description={meta.desc}
          meta={
            <SummaryRow
              className="md:grid-cols-3 xl:grid-cols-3"
              items={[
                {
                  label: "Status",
                  value: agent?.status ?? "needs_setup",
                  detail: isActive
                    ? "Available across commands and workflow steps."
                    : "Currently inactive or waiting for setup.",
                  icon: Activity,
                  tone: isActive ? "success" : "neutral",
                },
                {
                  label: "Capabilities",
                  value: meta.capabilities.length,
                  detail: "The core jobs this assistant is tuned to support.",
                  icon: Layers,
                  tone: meta.capabilities.length > 0 ? "primary" : "neutral",
                },
                {
                  label: "Integrations",
                  value: meta.integrations.length,
                  detail: meta.integrations.length > 0
                    ? "Systems this assistant expects to rely on."
                    : "No external integrations required for primary use.",
                  icon: Zap,
                  tone: meta.integrations.length > 0 ? "warning" : "neutral",
                },
              ]}
            />
          }
        />
      </div>

      {/* Stat cards row */}
      <div className="grid gap-3 sm:grid-cols-3">
        {/* Status */}
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Status</p>
            <div className="mt-3 flex items-center gap-2">
              <StatusPill status={agent?.status ?? "needs_setup"} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {isActive
                ? "Available in commands and workflows."
                : agent?.status === "needs_setup"
                  ? "Activate to start using this assistant."
                  : "Disabled — won't appear in command picker."}
            </p>
          </CardContent>
        </Card>

        {/* Type */}
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Specialist</p>
            <div className="mt-3">
              <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium capitalize", meta.color)}>
                <Settings2 className="size-3" />
                {agent?.type ?? "assistant"}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {meta.capabilities.length} capabilities
            </p>
          </CardContent>
        </Card>

        {/* Integrations */}
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Integrations</p>
            {meta.integrations.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {meta.integrations.map((intg) => {
                  const IntgIcon = integrationIcons[intg] ?? Zap;
                  return (
                    <span
                      key={intg}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      <IntgIcon className="size-3" />
                      {intg}
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">No external integrations needed.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Two-column main content */}
      <div className="grid gap-5 lg:grid-cols-5">
        {/* Left: Capabilities + Status control */}
        <div className="space-y-5 lg:col-span-2">
          {/* Capabilities */}
          <Card>
            <CardContent className="p-5">
              <p className="mb-4 text-sm font-semibold">Capabilities</p>
              <div className="space-y-2.5">
                {meta.capabilities.map((cap) => {
                  const CapIcon = capabilityIcons[cap] ?? Layers;
                  return (
                    <div key={cap} className="flex items-center gap-2.5">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--badge-running-bg))]">
                        <CapIcon className="size-3.5 text-primary" />
                      </div>
                      <span className="text-sm text-foreground">{cap}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Activate / Disable */}
          <Card
            className={cn(
              "border",
              isActive
                ? "border-[hsl(var(--badge-success-border))] bg-[hsl(var(--badge-success-bg))]"
                : "border-border",
            )}
          >
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                {isActive ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[hsl(var(--badge-success-text))]" />
                ) : (
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {isActive ? "Active" : agent?.status === "needs_setup" ? "Setup required" : "Inactive"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {isActive
                      ? "This assistant is available in Command Center and workflow steps."
                      : "Activate to make this assistant selectable in commands."}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  size="sm"
                  variant={isActive ? "outline" : "default"}
                  disabled={toggling || !isRealData}
                  onClick={() => void handleToggle()}
                  className="flex-1"
                >
                  {toggling ? "Updating…" : isActive ? "Disable" : "Activate"}
                </Button>
                {isActive && (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/">
                      Use now
                      <ExternalLink className="ml-1.5 size-3" />
                    </Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Custom instructions */}
        <div className="lg:col-span-3">
          <Card className="h-full">
            <CardContent className="p-5">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-semibold">Custom instructions</p>
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    draft.length > MAX_CHARS ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {draft.length} / {MAX_CHARS}
                </span>
              </div>
              <p className="mb-4 text-xs leading-5 text-muted-foreground">
                Added to this assistant's system prompt on every command. Share context about your
                business, preferred formats, or rules this assistant should always follow.
              </p>
              <textarea
                className={cn(
                  "w-full resize-none rounded-xl border bg-white px-4 py-3 text-sm leading-6 placeholder:text-muted-foreground/60",
                  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50",
                  !isRealData && "cursor-not-allowed opacity-60",
                )}
                rows={10}
                maxLength={MAX_CHARS}
                placeholder={meta.instructionPlaceholder}
                value={draft}
                disabled={!isRealData}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="mt-3 flex items-center justify-between">
                {agent?.systemPromptAddition ? (
                  <p className="text-xs text-primary/70">✦ Custom instructions active</p>
                ) : (
                  <span />
                )}
                <Button
                  size="sm"
                  disabled={!isDirty || saving || !isRealData || draft.length > MAX_CHARS}
                  onClick={() => void handleSaveInstructions()}
                >
                  {saving ? "Saving…" : "Save instructions"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
