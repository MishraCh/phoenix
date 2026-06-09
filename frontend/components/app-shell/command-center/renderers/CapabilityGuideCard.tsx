"use client";

import { ArrowRight, Bot, CheckCircle2, PlugZap, Sparkles, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CapabilityGuideResult } from "@/services/command";

const categoryIcons = [Sparkles, PlugZap, Bot, Workflow];

export function CapabilityGuideCard({ result }: { result: CapabilityGuideResult }) {
  const categories = result.categories ?? [];
  const connected = result.connectedIntegrations ?? [];
  const limitations = result.limitations ?? [];
  const nextActions = result.nextActions ?? [];

  return (
    <section className="max-w-[58rem] overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm">
      <div className="border-b border-border/60 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.10),transparent_34%),linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.86))] px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Gideon guide
        </p>
        <h3 className="mt-2 text-[18px] font-semibold tracking-tight text-foreground">
          {result.headline ?? "Gideon helps you understand, decide, and act across your workspace."}
        </h3>
        {result.selectedAgentName ? (
          <p className="mt-1 text-[13px] text-muted-foreground">
            Current lens: {result.selectedAgentName}
          </p>
        ) : null}
      </div>

      <div className="grid gap-0 divide-y divide-border/55 md:grid-cols-2 md:divide-x md:divide-y-0">
        {categories.map((category, index) => {
          const Icon = categoryIcons[index % categoryIcons.length];
          return (
            <div key={category.title} className="min-w-0 p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-[14px] font-semibold text-foreground">{category.title}</h4>
                  <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
                    {category.description}
                  </p>
                </div>
              </div>
              {category.examples?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {category.examples.slice(0, 3).map((example) => (
                    <span
                      key={example}
                      className="rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-foreground/70"
                    >
                      {example}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 border-t border-border/60 px-5 py-4 md:grid-cols-[1.2fr_0.8fr]">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Connected capabilities
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {connected.length ? (
              connected.map((integration) => (
                <span
                  key={integration.provider}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-800"
                >
                  <CheckCircle2 className="size-3.5" />
                  {integration.label}
                </span>
              ))
            ) : (
              <span className="text-[13px] text-muted-foreground">
                Connect Gmail or HubSpot to unlock live workspace actions.
              </span>
            )}
          </div>
        </div>
        {limitations.length ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Guardrails
            </p>
            <ul className="mt-2 space-y-1 text-[12px] leading-5 text-muted-foreground">
              {limitations.slice(0, 3).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {nextActions.length ? (
        <div className="flex flex-wrap gap-2 border-t border-border/60 bg-muted/20 px-5 py-3">
          {nextActions.slice(0, 3).map((action) => (
            <Button
              key={action.label}
              size="sm"
              variant="outline"
              className="h-8 rounded-full text-[12px]"
              type="button"
              title={action.prompt}
            >
              {action.label}
              <ArrowRight className="ml-1.5 size-3.5" />
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
