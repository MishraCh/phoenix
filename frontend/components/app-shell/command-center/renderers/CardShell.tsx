"use client";

import { useState, type ReactNode } from "react";
import {
  FileText,
  Mail,
  Phone,
  Radio,
  Swords,
  TrendingUp,
  User,
  Briefcase,
  Building,
  LineChart,
  AlertTriangle,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Card type config ───────────────────────────────────────────────────────────

export type CardType =
  | "contact_brief"
  | "pre_call_brief"
  | "opportunity_scorecard"
  | "outreach_draft"
  | "competitor_battlecard"
  | "signal_radar"
  | "document_analysis"
  | "sales_intelligence"
  | "account_snapshot"
  | "pipeline_health"
  | "deal_risk"
  | "meeting_summary"
  | string;

type CardConfig = {
  icon: LucideIcon;
  label: string;
  iconBg: string;
  iconText: string;
  headerBg: string;
  headerBorder: string;
  accentBar: string;
  badgeBg: string;
  badgeText: string;
};

const CARD_CONFIGS: Record<string, CardConfig> = {
  contact_brief: {
    icon: User,
    label: "Contact Brief",
    iconBg: "bg-indigo-100",
    iconText: "text-indigo-600",
    headerBg: "bg-indigo-50/60",
    headerBorder: "border-indigo-100",
    accentBar: "bg-indigo-500",
    badgeBg: "bg-indigo-100",
    badgeText: "text-indigo-700",
  },
  pre_call_brief: {
    icon: Phone,
    label: "Pre-Call Brief",
    iconBg: "bg-violet-100",
    iconText: "text-violet-600",
    headerBg: "bg-violet-50/60",
    headerBorder: "border-violet-100",
    accentBar: "bg-violet-500",
    badgeBg: "bg-violet-100",
    badgeText: "text-violet-700",
  },
  opportunity_scorecard: {
    icon: TrendingUp,
    label: "Opportunity Scorecard",
    iconBg: "bg-emerald-100",
    iconText: "text-emerald-600",
    headerBg: "bg-emerald-50/60",
    headerBorder: "border-emerald-100",
    accentBar: "bg-emerald-500",
    badgeBg: "bg-emerald-100",
    badgeText: "text-emerald-700",
  },
  outreach_draft: {
    icon: Mail,
    label: "Outreach Draft",
    iconBg: "bg-sky-100",
    iconText: "text-sky-600",
    headerBg: "bg-sky-50/60",
    headerBorder: "border-sky-100",
    accentBar: "bg-sky-500",
    badgeBg: "bg-sky-100",
    badgeText: "text-sky-700",
  },
  competitor_battlecard: {
    icon: Swords,
    label: "Competitor Battlecard",
    iconBg: "bg-orange-100",
    iconText: "text-orange-600",
    headerBg: "bg-orange-50/60",
    headerBorder: "border-orange-100",
    accentBar: "bg-orange-500",
    badgeBg: "bg-orange-100",
    badgeText: "text-orange-700",
  },
  signal_radar: {
    icon: Radio,
    label: "Signal Radar",
    iconBg: "bg-amber-100",
    iconText: "text-amber-600",
    headerBg: "bg-amber-50/60",
    headerBorder: "border-amber-100",
    accentBar: "bg-amber-500",
    badgeBg: "bg-amber-100",
    badgeText: "text-amber-700",
  },
  document_analysis: {
    icon: FileText,
    label: "Document Analysis",
    iconBg: "bg-slate-100",
    iconText: "text-slate-600",
    headerBg: "bg-slate-50/60",
    headerBorder: "border-slate-100",
    accentBar: "bg-slate-400",
    badgeBg: "bg-slate-100",
    badgeText: "text-slate-600",
  },
  sales_intelligence: {
    icon: Briefcase,
    label: "Sales Intelligence",
    iconBg: "bg-blue-100",
    iconText: "text-blue-600",
    headerBg: "bg-blue-50/60",
    headerBorder: "border-blue-100",
    accentBar: "bg-blue-500",
    badgeBg: "bg-blue-100",
    badgeText: "text-blue-700",
  },
  account_snapshot: {
    icon: Building,
    label: "Account Snapshot",
    iconBg: "bg-slate-100",
    iconText: "text-slate-600",
    headerBg: "bg-slate-50/60",
    headerBorder: "border-slate-200",
    accentBar: "bg-slate-500",
    badgeBg: "bg-slate-200",
    badgeText: "text-slate-700",
  },
  pipeline_health: {
    icon: LineChart,
    label: "Pipeline Health",
    iconBg: "bg-emerald-100",
    iconText: "text-emerald-600",
    headerBg: "bg-emerald-50/60",
    headerBorder: "border-emerald-100",
    accentBar: "bg-emerald-500",
    badgeBg: "bg-emerald-100",
    badgeText: "text-emerald-700",
  },
  deal_risk: {
    icon: AlertTriangle,
    label: "Deal Risk",
    iconBg: "bg-rose-100",
    iconText: "text-rose-600",
    headerBg: "bg-rose-50/60",
    headerBorder: "border-rose-100",
    accentBar: "bg-rose-500",
    badgeBg: "bg-rose-100",
    badgeText: "text-rose-700",
  },
  meeting_summary: {
    icon: Users,
    label: "Meeting Summary",
    iconBg: "bg-cyan-100",
    iconText: "text-cyan-600",
    headerBg: "bg-cyan-50/60",
    headerBorder: "border-cyan-100",
    accentBar: "bg-cyan-500",
    badgeBg: "bg-cyan-100",
    badgeText: "text-cyan-700",
  },
};

const FALLBACK_CONFIG = CARD_CONFIGS["document_analysis"]!;

// ── Shared sub-components ──────────────────────────────────────────────────────

export function ConfidenceMeter({ confidence }: { confidence: number | undefined }) {
  if (confidence === undefined) return null;
  const pct = Math.round(confidence * 100);
  const barColor =
    pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-3 border-t border-border/30 pt-3 mt-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted/50">
        <div
          className={cn("h-full rounded-full transition-all duration-700", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
        {pct}% confidence
      </span>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
      {children}
    </p>
  );
}

export function Chips({
  items,
  tone = "default",
  maxVisible = 8,
}: {
  items: string[];
  tone?: "default" | "success" | "warning" | "danger" | "info";
  maxVisible?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;

  const visible = expanded ? items : items.slice(0, maxVisible);
  const hiddenCount = items.length - maxVisible;

  const chipClass: Record<string, string> = {
    default: "bg-muted/50 text-foreground/80 border-border/50",
    success: "bg-emerald-50 text-emerald-800 border-emerald-200/70",
    warning: "bg-amber-50 text-amber-800 border-amber-200/70",
    danger: "bg-rose-50 text-rose-800 border-rose-200/70",
    info: "bg-sky-50 text-sky-800 border-sky-200/70",
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((item, i) => (
        <span
          key={`${i}-${item.slice(0, 20)}`}
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-medium leading-5",
            chipClass[tone],
          )}
        >
          {item}
        </span>
      ))}
      {!expanded && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        >
          +{hiddenCount} more
        </button>
      )}
    </div>
  );
}

export function CalloutBlock({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "success" | "warning";
}) {
  const styles: Record<string, string> = {
    info: "border-primary/20 bg-primary/[0.04] text-foreground/90",
    success: "border-emerald-200/70 bg-emerald-50/70 text-emerald-900",
    warning: "border-amber-200/70 bg-amber-50/60 text-amber-900",
  };
  return (
    <div className={cn("rounded-xl border-l-[3px] px-4 py-3 text-[14px] leading-6", styles[tone])}>
      {children}
    </div>
  );
}

// ── CardShell ─────────────────────────────────────────────────────────────────

type CardShellProps = {
  type: CardType;
  sourceLabel?: string | null;
  children: ReactNode;
  className?: string;
};

export function CardShell({ type, sourceLabel, children, className }: CardShellProps) {
  const config = CARD_CONFIGS[type] ?? FALLBACK_CONFIG;
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[0_2px_16px_-6px_rgba(0,0,0,0.08)]",
        className,
      )}
    >
      {/* Accent bar */}
      <div className={cn("h-[3px] w-full", config.accentBar)} />

      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between gap-3 border-b px-4 py-2.5",
          config.headerBg,
          config.headerBorder,
        )}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md",
              config.iconBg,
              config.iconText,
            )}
          >
            <Icon className="size-3.5" />
          </div>
          <p className="text-[13px] font-semibold text-foreground">{config.label}</p>
        </div>
        {sourceLabel && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
              config.badgeBg,
              config.badgeText,
            )}
          >
            {sourceLabel}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-5 py-5">{children}</div>
    </div>
  );
}
