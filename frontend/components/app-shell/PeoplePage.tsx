"use client";

import Link from "next/link";
import { Bell, Link as LinkIcon, MessageCircle, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { ProductHeader } from "./ProductHeader";
import { PageSection, SummaryRow } from "./ProductPrimitives";

const peopleSections = [
  {
    title: "Key contacts",
    description: "People you work with most often will appear here once email and calendar context is connected.",
    icon: Users,
    iconBg: "bg-[#EEF4FF] text-primary",
    borderAccent: "border-t-2 border-t-primary/20",
  },
  {
    title: "Open relationship loops",
    description: "Follow-ups, outstanding asks, and important conversations will stay visible here.",
    icon: MessageCircle,
    iconBg: "bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))]",
    borderAccent: "border-t-2 border-t-warning/40",
  },
  {
    title: "Recent interaction signals",
    description: "Gideon will surface who needs attention based on your recent communication history.",
    icon: Bell,
    iconBg: "bg-[#E6FBF2] text-[#00925A]",
    borderAccent: "border-t-2 border-t-success/40",
  },
];

export function PeoplePage() {
  return (
    <section className="space-y-6">
      <ProductHeader
        eyebrow="People"
        title="People and relationship context"
        description="Keep the important contacts, conversations, and follow-through tied to your workspace."
        meta={
          <SummaryRow
            className="md:grid-cols-3 xl:grid-cols-3"
            items={[
              {
                label: "Key contacts",
                value: "0",
                detail: "Important people will appear here as communication sources connect.",
                icon: Users,
                tone: "neutral",
              },
              {
                label: "Open loops",
                value: "0",
                detail: "Follow-ups and relationship risks will stay visible.",
                icon: MessageCircle,
                tone: "warning",
              },
              {
                label: "Signals",
                value: "0",
                detail: "Recent interaction patterns Gideon can act on.",
                icon: Bell,
                tone: "primary",
              },
            ]}
          />
        }
      />

      <PageSection
        title="People surface"
        description="Once context is connected, this area should help you see who matters, what is open, and where follow-through is at risk."
      >
      <div className="grid gap-4 md:grid-cols-3">
        {peopleSections.map((section) => {
          const Icon = section.icon;
          return (
            <Card key={section.title} className={section.borderAccent}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${section.iconBg}`}>
                    <Icon className="size-4" />
                  </div>
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    Coming soon
                  </Badge>
                </div>
                <p className="mt-4 text-sm font-semibold">{section.title}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
      </PageSection>

      <PageSection className="border-dashed border-2" title="Get this surface ready" description="Connect a few systems first so Gideon can form people and relationship context.">
        <Card className="border-0 bg-transparent shadow-none">
        <CardContent className="p-0 md:p-2">
          <EmptyState
            icon={<Users className="size-8" />}
            title="No people context yet"
            description="Connect email, calendar, or CRM tools to help Gideon understand the people around your work."
            action={
              <Button asChild variant="secondary">
                <Link href="/integrations">
                  <LinkIcon className="mr-2 size-4" />
                  Connect tools
                </Link>
              </Button>
            }
            hint="Once connected, this space will highlight key contacts, recent conversations, and follow-up risk."
          />
        </CardContent>
      </Card>
      </PageSection>
    </section>
  );
}
