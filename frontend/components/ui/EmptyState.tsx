"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type EmptyStateTone = "default" | "success" | "warning" | "danger";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  hint?: string;
  tone?: EmptyStateTone;
  className?: string;
};

const toneStyles: Record<EmptyStateTone, string> = {
  default: "bg-[hsl(214_40%_98%)] border-dashed border-border",
  success: "bg-[hsl(var(--badge-success-bg))] border-[hsl(var(--badge-success-border))]",
  warning: "bg-[hsl(var(--badge-warning-bg))] border-[hsl(var(--badge-warning-border))]",
  danger: "bg-[hsl(var(--badge-danger-bg))] border-[hsl(var(--badge-danger-border))]",
};

export function EmptyState({ icon, title, description, action, hint, tone = "default", className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-[1.75rem] border px-6 py-10 text-center",
        toneStyles[tone],
        className,
      )}
    >
      {icon ? (
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-white/70 bg-white text-muted-foreground shadow-[0_12px_26px_-20px_rgba(30,20,80,0.35)]">
          {icon}
        </div>
      ) : null}
      <h3 className="mt-4 text-base font-semibold tracking-tight">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {hint ? <p className="mx-auto mt-3 max-w-md text-xs leading-5 text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
