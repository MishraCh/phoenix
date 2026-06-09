import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/EmptyState";

import { surfaceCopy } from "./navItems";
import { ProductHeader } from "./ProductHeader";
import { PageSection, SummaryRow } from "./ProductPrimitives";

type SurfacePath = keyof typeof surfaceCopy;

type PlaceholderPageProps = {
  path: SurfacePath;
};

const setupItems = [
  "Workspace access",
  "Saved context",
  "Connected tools",
  "First outputs",
];

export function PlaceholderPage({ path }: PlaceholderPageProps) {
  const surface = surfaceCopy[path];

  return (
    <section className="grid gap-6 xl:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <ProductHeader
          eyebrow={surface.eyebrow}
          title={surface.title}
          description={surface.description}
          meta={
            <SummaryRow
              className="md:grid-cols-2 xl:grid-cols-2"
              items={[
                {
                  label: "Surface status",
                  value: "Planned",
                  detail: "This page has the shell and information hierarchy ready for future product depth.",
                },
                {
                  label: "Next unlock",
                  value: "Context",
                  detail: "This area becomes useful as workspace data, outputs, and connected systems accumulate.",
                },
              ]}
            />
          }
        />
        <PageSection title="Surface preview" description="This area already follows the authenticated design system and is ready to hold future product logic.">
          <Card className="border-0 bg-transparent shadow-none">
          <CardContent className="p-0">
            <EmptyState
              title={`${surface.title} will fill in here`}
              description="As you keep setting up Gideon, this space will turn into a live working surface instead of a static overview."
            />
          </CardContent>
        </Card>
        </PageSection>
      </div>

      <PageSection className="h-fit" title="What unlocks this page" description="These building blocks make the thin surfaces feel useful as Gideon becomes more connected.">
        <Card className="h-fit border-0 bg-transparent shadow-none">
        <CardContent className="p-0">
          <p className="text-sm font-semibold">What helps this area come to life</p>
          <div className="mt-5 space-y-4">
          {setupItems.map((item, index) => (
            <div key={item} className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                {index + 1}
              </span>
              <p className="pt-1 text-sm text-muted-foreground">{item}</p>
            </div>
          ))}
        </div>
        <Button asChild className="mt-6 w-full" variant="secondary">
          <Link href="/onboarding">Open onboarding</Link>
        </Button>
        </CardContent>
      </Card>
      </PageSection>
    </section>
  );
}
