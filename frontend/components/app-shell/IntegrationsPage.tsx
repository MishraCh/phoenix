"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Mail,
  MessageSquare,
  LayoutDashboard,
  FileText,
  Database,
  Cloud,
  Activity,
  Kanban,
  CreditCard,
  Headset,
  Video,
  Calendar,
} from "lucide-react";
import { useSearchParams } from "next/navigation";

import { ErrorState } from "@/components/ui/ErrorState";
import { IntegrationLogo } from "@/components/ui/IntegrationLogo";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useIntegrationsQuery } from "@/hooks/useGideonQueries";
import { getFriendlyErrorMessage } from "@/lib/product";
import { fallbackIntegrations } from "@/services/integrations";

import { ProductHeader } from "./ProductHeader";
import { InlineStatusBanner, PageSection, SummaryRow } from "./ProductPrimitives";

const providerCatalog = [
  {
    category: "Communication",
    items: [
      { id: "gmail", name: "Gmail", icon: Mail, iconBg: "bg-[#4285F4]", iconText: "text-white", unlocks: ["Inbox triage", "Draft follow-up", "Thread context", "Approval-gated sending"], desc: "Bring Gmail threads into Gideon so it can summarize, draft replies, and turn email into workflows." },
      { id: "slack", name: "Slack", icon: MessageSquare, iconBg: "bg-[#4A154B]", iconText: "text-white", unlocks: ["Channel summaries", "Draft responses", "Action extraction", "Coming soon"], desc: "Connect Slack to let Gideon monitor important channels and draft updates." },
    ]
  },
  {
    category: "Productivity",
    items: [
      { id: "microsoft", name: "Microsoft 365", icon: LayoutDashboard, iconBg: "bg-[#00A4EF]", iconText: "text-white", unlocks: ["Outlook context", "Calendar coverage", "Planning support", "Coming soon"], desc: "Integrate your Microsoft environment for email and calendar access." },
      { id: "notion", name: "Notion", icon: FileText, iconBg: "bg-[#191919]", iconText: "text-white", unlocks: ["Doc search", "Page generation", "Database sync", "Coming soon"], desc: "Allow Gideon to read company context and draft new documentation." },
    ]
  },
  {
    category: "CRM & Finance",
    items: [
      { id: "hubspot", name: "HubSpot", icon: Database, iconBg: "bg-[#FF7A59]", iconText: "text-white", unlocks: ["Lead context", "Pipeline visibility", "Notes and tasks", "Approval-gated CRM actions"], desc: "Bring in deal context, contact history, and CRM execution support for sales workflows." },
      { id: "salesforce", name: "Salesforce", icon: Cloud, iconBg: "bg-[#00A1E0]", iconText: "text-white", unlocks: ["Account updates", "Opportunity tracking", "Coming soon"], desc: "Connect Salesforce for enterprise CRM context." },
      { id: "stripe", name: "Stripe", icon: CreditCard, iconBg: "bg-[#635BFF]", iconText: "text-white", unlocks: ["Revenue alerts", "Customer billing", "Coming soon"], desc: "Keep track of customer subscriptions and revenue milestones." },
    ]
  },
  {
    category: "Project Management",
    items: [
      { id: "linear", name: "Linear", icon: Activity, iconBg: "bg-[#5E6AD2]", iconText: "text-white", unlocks: ["Issue tracking", "Sprint summaries", "Coming soon"], desc: "Sync engineering and product workflows." },
      { id: "jira", name: "Jira", icon: Kanban, iconBg: "bg-[#0052CC]", iconText: "text-white", unlocks: ["Ticket context", "Release notes", "Coming soon"], desc: "Connect your Jira backlog for automatic updates." },
    ]
  },
  {
    category: "Support & Meetings",
    items: [
      { id: "zendesk", name: "Zendesk", icon: Headset, iconBg: "bg-[#03363D]", iconText: "text-white", unlocks: ["Ticket triage", "Draft responses", "Coming soon"], desc: "Help Gideon triage and draft support responses." },
      { id: "zoom", name: "Zoom", icon: Video, iconBg: "bg-[#2D8CFF]", iconText: "text-white", unlocks: ["Meeting recordings", "Transcripts", "Coming soon"], desc: "Pull in meeting transcripts for automatic summaries." },
      { id: "calendly", name: "Calendly", icon: Calendar, iconBg: "bg-[#006BFF]", iconText: "text-white", unlocks: ["Scheduling links", "Meeting context", "Coming soon"], desc: "Manage inbound meeting requests automatically." },
    ]
  }
];

export function IntegrationsPage() {
  const searchParams = useSearchParams();
  const integrationsQuery = useIntegrationsQuery();
  const [actionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const loading = integrationsQuery.isLoading && !integrationsQuery.data;
  const error = actionError
    ?? (integrationsQuery.error
      ? getFriendlyErrorMessage(integrationsQuery.error, "We couldn't load your connected tools yet.")
      : null);
  const integrations = integrationsQuery.data?.integrations ?? fallbackIntegrations;
  const connectedCount = integrations.filter((integration) => integration.status === "connected").length;
  const readyCount = providerCatalog.flatMap((category) => category.items).filter((provider) => provider.id === "gmail" || provider.id === "hubspot").length;

  const callbackMessage = useMemo(() => {
    const callbackStatus = searchParams.get("status");
    const message = searchParams.get("message");
    const provider = searchParams.get("provider");

    if (callbackStatus === "connected") {
      return `${provider === "hubspot" ? "HubSpot" : "Gmail"} connected. Refresh to pull in the latest context.`;
    }

    if (callbackStatus === "error") {
      return getFriendlyErrorMessage(message ? new Error(message) : null, "That connection needs attention.");
    }

    return null;
  }, [searchParams]);

  useEffect(() => {
    if (callbackMessage) {
      setStatusMessage(callbackMessage);
    }
  }, [callbackMessage]);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Integrations</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Connected tools</h1>
          <p className="mt-1 text-sm text-muted-foreground">Bring in the systems that give Gideon the context it needs to help across your day.</p>
        </div>
      </div>

      {statusMessage ? (
        <InlineStatusBanner title="Integration updated" description={statusMessage} tone="info" />
      ) : null}

      {error ? <ErrorState message={error} onRetry={() => void integrationsQuery.refetch()} /> : null}

      {loading ? <LoadingState label="Loading connected tools..." rows={3} /> : null}

      {!loading ? (
        <div className="space-y-8 mt-2">
          {(() => {
            const activeIntegrations = providerCatalog
              .flatMap((category) => category.items)
              .filter((provider) =>
                integrations.some(
                  (integration) =>
                    integration.provider === provider.id &&
                    (integration.status === "connected" ||
                      integration.status === "syncing" ||
                      integration.status === "error" ||
                      integration.status === "reconnect_needed")
                )
              );

            return (
              <>
                {activeIntegrations.length > 0 && (
                  <PageSection title="Active connections" contentClassName="mt-4 mb-10">
                    <div className="grid gap-3 md:grid-cols-2">
                      {activeIntegrations.map((provider) => {
                        const liveIntegration = integrations.find((integration) => integration.provider === provider.id) ?? null;
                        const isWorkspaceReady = provider.id === "gmail" || provider.id === "hubspot";

                        return (
                          <Card key={provider.id} className="transition-[border-color,box-shadow] duration-150 hover:border-primary/25 hover:shadow-sm">
                            <CardContent className="flex items-center gap-3 p-4">
                              <div className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${provider.iconBg} ${provider.iconText}`}>
                                <IntegrationLogo providerId={provider.id} fallbackIcon={provider.icon} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium text-foreground">{provider.name}</p>
                                  {liveIntegration ? <StatusPill status={liveIntegration.status} /> : <StatusPill status="planned" />}
                                </div>
                                <p className="mt-0.5 text-xs leading-5 text-muted-foreground line-clamp-1">{provider.desc}</p>
                              </div>
                              <div className="shrink-0">
                                {isWorkspaceReady ? (
                                  <Button asChild size="sm" variant="outline">
                                    <Link href={`/integrations/${provider.id}`}>Manage</Link>
                                  </Button>
                                ) : (
                                  <span className="rounded-md bg-muted px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                    Soon
                                  </span>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </PageSection>
                )}
                
                {providerCatalog.map((category) => (
                  <PageSection
                    key={category.category}
                    title={category.category}
                    contentClassName="mt-4"
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      {category.items.map((provider) => {
                        const liveIntegration =
                          integrations.find((integration) => integration.provider === provider.id) ??
                          fallbackIntegrations.find((integration) => integration.provider === provider.id) ??
                          null;
                        const isWorkspaceReady = provider.id === "gmail" || provider.id === "hubspot";

                        return (
                          <Card key={provider.id} className="transition-[border-color,box-shadow] duration-150 hover:border-primary/25 hover:shadow-sm">
                            <CardContent className="flex items-center gap-3 p-4">
                              <div className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${provider.iconBg} ${provider.iconText}`}>
                                <IntegrationLogo providerId={provider.id} fallbackIcon={provider.icon} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium text-foreground">{provider.name}</p>
                                  {liveIntegration ? <StatusPill status={liveIntegration.status} /> : <StatusPill status="planned" />}
                                </div>
                                <p className="mt-0.5 text-xs leading-5 text-muted-foreground line-clamp-1">{provider.desc}</p>
                              </div>
                              <div className="shrink-0">
                                {isWorkspaceReady ? (
                                  <Button asChild size="sm" variant="outline">
                                    <Link href={`/integrations/${provider.id}`}>Open</Link>
                                  </Button>
                                ) : (
                                  <span className="rounded-md bg-muted px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                    Soon
                                  </span>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </PageSection>
                ))}
              </>
            );
          })()}
        </div>
      ) : null}
    </section>
  );
}
