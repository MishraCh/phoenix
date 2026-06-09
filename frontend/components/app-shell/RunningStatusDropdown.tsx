"use client";
import Link from "next/link";
import { Command, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRunningStatus } from "@/hooks/useRunningStatus";
import { useRunningStatusContext } from "./RunningStatusProvider";
import type { RunningItem } from "./RunningStatusProvider";

type SectionProps = {
  title: string;
  accent: string;
  items: RunningItem[];
  onDismiss?: (id: string) => void;
};

function Section({ title, accent, items, onDismiss }: SectionProps) {
  if (!items.length) return null;
  return (
    <div className="px-3 py-2">
      <p className={`mb-1.5 px-2 text-xs font-medium ${accent}`}>{title}</p>
      {items.map((item) => {
        const content = (
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
            <p className="truncate text-xs text-muted-foreground">{item.statusCopy}</p>
          </div>
        );
        return (
          <div key={item.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-secondary/40">
            {item.href ? (
              <Link href={item.href} className="min-w-0 flex-1">
                {content}
              </Link>
            ) : (
              <div className="min-w-0 flex-1">{content}</div>
            )}
            {onDismiss ? (
              <button
                onClick={() => onDismiss(item.id)}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function RunningStatusDropdown() {
  const { items, activeCount, waitingCount, dismiss } = useRunningStatus();
  const { setDropdownOpen } = useRunningStatusContext();

  const waiting = items.filter((i) => i.status === "waiting_approval");
  const running = items.filter((i) => i.status === "running");
  const completed = items.filter((i) => i.status === "completed");
  const failed = items.filter((i) => i.status === "failed");

  return (
    <DropdownMenu onOpenChange={setDropdownOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="relative h-9 gap-1.5 rounded-full border-border/70 px-3.5 text-sm text-muted-foreground shadow-none hover:border-primary/30 hover:bg-muted/40"
        >
          {activeCount > 0 ? (
            <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          ) : waitingCount > 0 ? (
            <span className="size-1.5 rounded-full bg-[hsl(var(--badge-warning-border))]" />
          ) : (
            <Command className="size-3.5 opacity-60" />
          )}
          <span>Running</span>
          {(activeCount > 0 || waitingCount > 0) ? (
            <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
              {activeCount + waitingCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-0" sideOffset={8}>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing running right now.</p>
        ) : (
          <div className="divide-y divide-border/50 py-1">
            <Section title="Waiting for you" accent="text-[hsl(var(--badge-warning-text))]" items={waiting} />
            <Section title="Running now" accent="text-primary" items={running} />
            <Section title="Recently completed" accent="text-[hsl(var(--badge-success-text))]" items={completed} />
            <Section title="Failed" accent="text-destructive" items={failed} onDismiss={dismiss} />
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
