"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type SectionFrameProps = {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  tone?: "default" | "soft" | "subtle";
};

type PageSectionProps = {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

type SummaryItem = {
  label: string;
  value: string | number;
  detail?: string;
  icon?: LucideIcon;
  tone?: "primary" | "success" | "warning" | "neutral";
  actionLabel?: string;
  actionHref?: string;
};

type SummaryRowProps = {
  items: SummaryItem[];
  className?: string;
};

type ToolbarRowProps = {
  children: ReactNode;
  className?: string;
};

type InlineStatusBannerProps = {
  title?: string;
  description: string;
  tone?: "info" | "success" | "warning" | "error";
  action?: ReactNode;
  className?: string;
};

type EmptyPanelProps = {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
};

type DataListShellProps = {
  title?: string;
  description?: string;
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
};

type SplitDetailLayoutProps = {
  list: ReactNode;
  detail: ReactNode;
  aside?: ReactNode;
  className?: string;
};

const frameToneStyles: Record<NonNullable<SectionFrameProps["tone"]>, string> = {
  default: "border-border/50 bg-white/90 shadow-card",
  soft: "border-border/40 bg-[linear-gradient(180deg,rgba(255,255,255,0.94)_0%,rgba(247,247,253,0.96)_100%)] shadow-panel",
  subtle: "border-border/35 bg-background/80 shadow-none",
};

const summaryToneStyles: Record<NonNullable<SummaryItem["tone"]>, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-50 text-emerald-600",
  warning: "bg-amber-50 text-amber-700",
  neutral: "bg-secondary text-muted-foreground",
};

const bannerToneStyles: Record<NonNullable<InlineStatusBannerProps["tone"]>, string> = {
  info: "border-primary/15 bg-primary/5 text-primary",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  error: "border-rose-200 bg-rose-50 text-rose-700",
};

export function SectionFrame({
  children,
  className,
  padded = true,
  tone = "default",
}: SectionFrameProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className={cn(
        "overflow-hidden rounded-shell border backdrop-blur-xl",
        frameToneStyles[tone],
        padded && "p-6 md:p-7",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

export function PageSection({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: PageSectionProps) {
  return (
    <SectionFrame className={className} tone="soft">
      {title || description || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            {title ? <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2> : null}
            {description ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn(title || description || actions ? "mt-6" : "", contentClassName)}>{children}</div>
    </SectionFrame>
  );
}

export function SummaryRow({ items, className }: SummaryRowProps) {
  return (
    <div className={cn("grid gap-4 md:grid-cols-2 xl:grid-cols-4", className)}>
      {items.map((item, index) => {
        const Icon = item.icon;

        return (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, ease: "easeOut", delay: index * 0.03 }}
            className="group relative overflow-hidden rounded-[1.75rem] border border-border/45 bg-white/88 p-5 shadow-card backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-panel"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-3 text-[2rem] font-semibold tracking-[-0.06em] text-foreground">
                  {item.value}
                </p>
              </div>
              {Icon ? (
                <div
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-2xl ring-1 ring-black/5",
                    summaryToneStyles[item.tone ?? "neutral"],
                  )}
                >
                  <Icon className="size-4.5" />
                </div>
              ) : null}
            </div>
            {item.detail ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.detail}</p> : null}
            {item.actionLabel && item.actionHref ? (
              <Link
                href={item.actionHref}
                className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary transition-colors hover:text-primary/75"
              >
                {item.actionLabel}
              </Link>
            ) : null}
          </motion.div>
        );
      })}
    </div>
  );
}

export function ToolbarRow({ children, className }: ToolbarRowProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-border/45 bg-background/75 px-4 py-3 backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function InlineStatusBanner({
  title,
  description,
  tone = "info",
  action,
  className,
}: InlineStatusBannerProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-4 rounded-[1.5rem] border px-4 py-3.5",
        bannerToneStyles[tone],
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {title ? <p className="text-sm font-semibold">{title}</p> : null}
        <p className={cn("text-sm leading-6", title ? "mt-1" : "")}>{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function EmptyPanel({ title, description, icon, action, className }: EmptyPanelProps) {
  return (
    <div
      className={cn(
        "flex min-h-52 flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-border/70 bg-muted/15 px-6 py-8 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="flex size-12 items-center justify-center rounded-2xl bg-white text-primary shadow-sm ring-1 ring-border/60">
          {icon}
        </div>
      ) : null}
      <h3 className={cn("text-base font-semibold text-foreground", icon ? "mt-4" : "")}>{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function DataListShell({
  title,
  description,
  toolbar,
  children,
  className,
}: DataListShellProps) {
  return (
    <PageSection
      className={className}
      title={title}
      description={description}
      actions={toolbar}
      contentClassName="mt-5"
    >
      {children}
    </PageSection>
  );
}

export function SplitDetailLayout({
  list,
  detail,
  aside,
  className,
}: SplitDetailLayoutProps) {
  return (
    <div
      className={cn(
        "grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]",
        aside ? "2xl:grid-cols-[340px_minmax(0,1fr)_360px]" : "",
        className,
      )}
    >
      {list}
      {detail}
      {aside ?? null}
    </div>
  );
}
