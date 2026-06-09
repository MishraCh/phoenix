"use client";

import { History } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusPill } from "@/components/ui/StatusPill";
import { Card, CardContent } from "@/components/ui/card";
import { useActivityQuery } from "@/hooks/useGideonQueries";
import { getFriendlyErrorMessage } from "@/lib/product";

import { ProductHeader } from "./ProductHeader";
import { PageSection, SummaryRow } from "./ProductPrimitives";

export function ActivityPage() {
  const activityQuery = useActivityQuery();
  const events = activityQuery.data?.events ?? [];
  const loading = activityQuery.isLoading && !activityQuery.data;
  const error = activityQuery.error
    ? getFriendlyErrorMessage(activityQuery.error, "We couldn't load recent activity yet.")
    : null;
  const workflowEvents = events.filter((event) => event.entityType === "workflow" || event.entityType === "workflow_run").length;
  const approvalEvents = events.filter((event) => event.entityType === "approval").length;

  return (
    <section className="space-y-6">
      <ProductHeader
        eyebrow="Activity"
        title="Workspace activity"
        description="Track the actions, approvals, runs, and saved outputs that have moved this workspace forward."
        meta={
          <SummaryRow
            className="md:grid-cols-3 xl:grid-cols-3"
            items={[
              {
                label: "Recent events",
                value: events.length,
                detail: "The latest meaningful system and workspace activity.",
                icon: History,
                tone: events.length > 0 ? "primary" : "neutral",
              },
              {
                label: "Workflow activity",
                value: workflowEvents,
                detail: "Runs, state changes, and automation-related history.",
                icon: History,
                tone: workflowEvents > 0 ? "success" : "neutral",
              },
              {
                label: "Approval activity",
                value: approvalEvents,
                detail: "Decisions and action reviews recorded in this workspace.",
                icon: History,
                tone: approvalEvents > 0 ? "warning" : "neutral",
              },
            ]}
          />
        }
      />

      {error ? <ErrorState message={error} onRetry={() => void activityQuery.refetch()} /> : null}

      <PageSection title="Activity timeline" description="A running record of the actions, approvals, and outputs that moved the workspace forward.">
        <Card className="border-0 bg-transparent shadow-none">
        <CardContent className="p-0">
          {loading ? (
            <LoadingState label="Loading activity..." rows={4} />
          ) : events.length > 0 ? (
            <div className="divide-y divide-border">
              {events.map((event) => (
                <div key={event.id} className="grid gap-3 rounded-[1.25rem] py-4 transition-colors hover:bg-background/70 lg:grid-cols-[10rem_1fr_auto] lg:items-center">
                  <StatusPill status={event.eventType} />
                  <div>
                    <p className="text-sm font-medium text-foreground">{event.summary}</p>
                    {event.entityType ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {event.entityType.replace(/_/g, " ")}
                      </p>
                    ) : null}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<History className="size-6" />}
              title="No activity yet"
              description="Activity will appear here as Gideon prepares work, records decisions, and saves outputs."
              />
            )}
        </CardContent>
      </Card>
      </PageSection>
    </section>
  );
}
