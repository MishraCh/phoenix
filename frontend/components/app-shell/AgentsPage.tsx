"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Target,
  BookOpen,
  UserPlus,
  Users,
  Briefcase,
  Activity,
  Settings2,
  Globe,
  FileText,
  GitBranch,
  Bell,
  Mail,
  BarChart2,
  Layers,
  ExternalLink,
} from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusPill } from "@/components/ui/StatusPill";
import { useToast } from "@/components/ui/ToastProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { gideonQueryKeys, useAgentsQuery } from "@/hooks/useGideonQueries";
import { cn } from "@/lib/utils";
import { getFriendlyErrorMessage } from "@/lib/product";
import { fallbackAgents, updateAgentConfig } from "@/services/agents";

import { ProductHeader } from "./ProductHeader";
import { PageSection, SummaryRow } from "./ProductPrimitives";

// ── Per-agent metadata ────────────────────────────────────────────────────────

const agentMeta: Record<
  string,
  {
    icon: React.ElementType;
    desc: string;
    capabilities: string[];
    integrations: string[];
    instructionPlaceholder: string;
  }
> = {
  executive: {
    icon: Briefcase,
    desc: "Priorities, briefings, meeting prep, and operating rhythm support.",
    capabilities: ["Web research", "Save artifacts", "Draft workflows", "Notifications"],
    integrations: ["Calendar", "Email"],
    instructionPlaceholder:
      "e.g. Always flag items that need legal review. Use our OKR framework when summarising priorities.",
  },
  sales: {
    icon: Target,
    desc: "Lead follow-up, CRM context, drafts, and pipeline nudges.",
    capabilities: ["Draft emails", "CRM leads", "Web research", "Save artifacts"],
    integrations: ["CRM", "Email"],
    instructionPlaceholder:
      "e.g. Our CRM is HubSpot. Never send outbound without an approval step. Deal stages: Prospect → Qualified → Proposal.",
  },
  research: {
    icon: BookOpen,
    desc: "Company, person, market, and public web research.",
    capabilities: ["Deep web research", "URL extraction", "Structured data", "Save artifacts"],
    integrations: ["Web"],
    instructionPlaceholder:
      "e.g. Always cite sources. Prefer recent results (last 12 months). Summarise in bullet points with a 3-line executive summary at the top.",
  },
  operations: {
    icon: Activity,
    desc: "Workflow hygiene, open loops, process checks, and internal reminders.",
    capabilities: ["Draft workflows", "Notifications", "Web research", "Save artifacts"],
    integrations: [],
    instructionPlaceholder:
      "e.g. We follow a weekly ops rhythm on Mondays. Escalate anything that blocks more than one team.",
  },
  customer: {
    icon: Users,
    desc: "Customer escalations, account context, open loops, and response drafts.",
    capabilities: ["Draft emails", "Notifications", "Web research", "Save artifacts"],
    integrations: ["Email"],
    instructionPlaceholder:
      "e.g. Our SLA is 4 hours for tier-1 customers. Always propose a resolution before escalating.",
  },
  recruiting: {
    icon: UserPlus,
    desc: "Candidate context, interview prep, follow-ups, and recruiting open loops.",
    capabilities: ["Draft emails", "Draft workflows", "Web research", "Save artifacts"],
    integrations: ["Calendar", "Email"],
    instructionPlaceholder:
      "e.g. We use a 3-stage process: screen → technical → values. Always include a personalised note in outreach drafts.",
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

// ── Main page ─────────────────────────────────────────────────────────────────

export function AgentsPage() {
  const { idToken } = useAuth();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const agentsQuery = useAgentsQuery();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const isRealData = Boolean(agentsQuery.data);
  const agents = agentsQuery.data?.agents.length ? agentsQuery.data.agents : fallbackAgents;
  const loading = agentsQuery.isLoading && !agentsQuery.data;
  const error = agentsQuery.error
    ? getFriendlyErrorMessage(agentsQuery.error, "We couldn't load your assistants yet.")
    : null;

  const activeCount = useMemo(() => agents.filter((a) => a.status === "active").length, [agents]);

  async function handleStatusChange(agentId: string, newStatus: "active" | "disabled") {
    if (!idToken || !isRealData) return;
    setUpdatingId(agentId);
    try {
      await updateAgentConfig(idToken, agentId, { status: newStatus });
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.agents(idToken) });
    } catch (err) {
      pushToast({
        title: "Couldn't update agent",
        description: getFriendlyErrorMessage(err, "Try again in a moment."),
        tone: "error",
      });
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <section className="space-y-6">
        <ProductHeader
          eyebrow="Agents"
          title="Your assistants"
          description="Activate the specialists Gideon can call on, and tune their behaviour with custom instructions."
          meta={
            <SummaryRow
              className="md:grid-cols-3 xl:grid-cols-3"
              items={[
                {
                  label: "Available",
                  value: agents.length,
                  detail: "Visible assistants Gideon can route work through.",
                  icon: Bot,
                  tone: "neutral",
                },
                {
                  label: "Active",
                  value: activeCount,
                  detail: "Assistants currently enabled for command and workflow use.",
                  icon: Activity,
                  tone: activeCount > 0 ? "success" : "neutral",
                },
                {
                  label: "Coverage",
                  value: agents.length > 0 ? `${Math.round((activeCount / agents.length) * 100)}%` : "0%",
                  detail: "How much of the assistant roster is currently switched on.",
                  icon: Settings2,
                  tone: activeCount > 0 ? "primary" : "neutral",
                },
              ]}
            />
          }
        />

        {error ? <ErrorState message={error} onRetry={() => void agentsQuery.refetch()} /> : null}

        {/* Coverage bar */}
        <PageSection
          title="Assistant coverage"
          description="Decide which specialists should be available in command and workflow surfaces, then tune their working instructions."
        >
        <div className="flex flex-col justify-between gap-4 rounded-container border border-border bg-white/60 p-5 md:flex-row md:items-center">
          <div className="flex-1">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-sm font-semibold">
                {loading
                  ? "Loading assistants…"
                  : activeCount > 0
                    ? `${activeCount} of ${agents.length} assistants active`
                    : "No assistants active yet"}
              </h2>
              {!loading && agents.length > 0 && (
                <span className="font-mono-data text-sm font-semibold text-primary">
                  {Math.round((activeCount / agents.length) * 100)}%
                </span>
              )}
            </div>
            {!loading && agents.length > 0 && (
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${Math.round((activeCount / agents.length) * 100)}%` }}
                />
              </div>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              {activeCount > 0
                ? "Active agents are available in Command Center and workflow steps."
                : "Activate an assistant below to start using it in commands."}
            </p>
          </div>
          {activeCount > 0 && (
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link href="/">
                Open Command Center
                <ExternalLink className="ml-2 size-3.5" />
              </Link>
            </Button>
          )}
        </div>
        </PageSection>

        {loading ? (
          <LoadingState label="Loading assistants…" rows={4} />
        ) : agents.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => {
              const meta = agentMeta[agent.type as keyof typeof agentMeta];
              const AgentIcon = meta?.icon ?? Bot;
              const isUpdating = updatingId === agent.id;
              const isActive = agent.status === "active";
              const caps = meta?.capabilities.slice(0, 3) ?? [];

              return (
                <Card
                  key={agent.id}
                  className={cn(
                    "overflow-hidden transition-shadow hover:shadow-sm border-l-4",
                    isActive ? "border-l-primary/50 ring-1 ring-primary/10" : "border-l-transparent opacity-75",
                  )}
                >
                  <CardContent className="p-6">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-3">
                      <div
                        className={cn(
                          "flex size-11 items-center justify-center rounded-2xl shadow-sm ring-1 ring-border",
                          isActive
                            ? "bg-[hsl(var(--badge-running-bg))] text-primary"
                            : "bg-muted/40 text-muted-foreground",
                        )}
                      >
                        <AgentIcon className="size-5" />
                      </div>
                      <StatusPill status={agent.status} />
                    </div>

                    {/* Name + description */}
                    <h3 className="mt-4 text-base font-semibold">{agent.name}</h3>
                    <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
                      {meta?.desc ?? "Supports the flow of work inside this workspace."}
                    </p>

                    {/* Capability chips */}
                    {caps.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {caps.map((cap) => {
                          const CapIcon = capabilityIcons[cap] ?? Layers;
                          return (
                            <span
                              key={cap}
                              className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--badge-running-border))] bg-[hsl(var(--badge-running-bg))] px-2 py-0.5 text-xs text-primary"
                            >
                              <CapIcon className="size-3" />
                              {cap}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Custom instructions indicator */}
                    {agent.systemPromptAddition && (
                      <p className="mt-3 text-xs text-primary/70">
                        ✦ Custom instructions set
                      </p>
                    )}

                    {/* Actions */}
                    <div className="mt-5 flex gap-2">
                      {isActive ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isUpdating || !isRealData}
                            onClick={() => void handleStatusChange(agent.id, "disabled")}
                            className="text-xs"
                          >
                            {isUpdating ? "Updating…" : "Disable"}
                          </Button>
                          <Button asChild size="sm" variant="outline" className="flex-1 text-xs">
                            <Link href={`/agents/${agent.id}`}>
                              <Settings2 className="mr-1.5 size-3.5" />
                              Configure
                            </Link>
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            className="flex-1 text-xs"
                            variant={agent.status === "needs_setup" ? "default" : "secondary"}
                            disabled={isUpdating || !isRealData}
                            onClick={() => void handleStatusChange(agent.id, "active")}
                          >
                            {isUpdating ? "Updating…" : "Activate"}
                          </Button>
                          <Button asChild size="sm" variant="outline" className="text-xs">
                            <Link href={`/agents/${agent.id}`}>
                              <Settings2 className="size-3.5" />
                            </Link>
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Bot className="size-6" />}
            title="No assistants available yet"
            description="Assistants will appear here as your workspace finishes setup."
          />
        )}
    </section>
  );
}
