"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { Inter, JetBrains_Mono, Outfit } from "next/font/google";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Circle,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  Workflow,
  BadgeCheck,
  FileText,
  BarChart3,
  BriefcaseBusiness,
  Users,
  RefreshCw,
  SearchCheck,
  BrainCircuit,
} from "lucide-react";

import { cn } from "@/lib/utils";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-landing-display",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-landing-body",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-landing-mono",
  display: "swap",
});

const integrations = [
  "Stripe",
  "Slack",
  "HubSpot",
  "Salesforce",
  "Notion",
  "Jira",
  "QuickBooks",
  "Google Workspace",
] as const;

const trustMetrics = [
  { value: "2,000+", label: "Workflows automated", sublabel: "across founder offices" },
  { value: "120+", label: "Integrations supported", sublabel: "Stripe, Slack, HubSpot, more" },
  { value: "15+", label: "Operational functions", sublabel: "Reporting, hiring, finance, sales, coordination" },
  { value: "20+", label: "Hours saved weekly", sublabel: "for leadership teams" },
] as const;

const chaosCards = [
  { title: "Investor update", status: "overdue", rotate: "rotate-[15deg]", x: "-left-5", y: "top-3" },
  { title: "Hiring approval", status: "pending", rotate: "-rotate-[12deg]", x: "left-44", y: "top-14" },
  { title: "KPI report", status: "outdated", rotate: "rotate-[14deg]", x: "left-3", y: "top-32" },
  { title: "Follow-up", status: "missed", rotate: "-rotate-[9deg]", x: "left-36", y: "top-56" },
  { title: "Data sync", status: "inconsistent", rotate: "rotate-[10deg]", x: "left-2", y: "top-72" },
] as const;

const coordinationCards = [
  { title: "Investor updates", status: "on track", icon: FileText },
  { title: "Hiring workflow", status: "active", icon: Users },
  { title: "KPI tracking", status: "live", icon: BarChart3 },
  { title: "Sales follow-ups", status: "running", icon: BriefcaseBusiness },
  { title: "Team coordination", status: "synced", icon: RefreshCw },
  { title: "Reports & insights", status: "up to date", icon: SearchCheck },
] as const;

const intelligenceCards = [
  {
    title: "External Systems",
    icon: Workflow,
    items: ["Stripe", "Slack", "HubSpot", "Notion"],
    featured: false,
  },
  {
    title: "Operational Context",
    icon: FileText,
    items: ["SOPs", "Reports", "Templates", "Goals"],
    featured: false,
  },
  {
    title: "Gideon Intelligence",
    icon: BrainCircuit,
    items: ["Memory", "Reasoning", "Coordination", "Drafting"],
    featured: true,
  },
  {
    title: "Workflow Execution",
    icon: Sparkles,
    items: ["Drafts", "Approvals", "Notifications", "Sync"],
    featured: false,
  },
] as const;

const securityCards = [
  { title: "End-to-end encryption", body: "AES-256 at rest, TLS 1.3 in transit.", icon: Lock },
  { title: "Audit logs", body: "Immutable action history for every workflow.", icon: FileText },
  { title: "Role permissions", body: "Granular RBAC with workspace scoping.", icon: ShieldCheck },
  { title: "Approval systems", body: "Human-in-the-loop for every execution.", icon: BadgeCheck },
  { title: "Private deployment", body: "VPC-isolated, single-tenant available.", icon: Workflow },
  { title: "On-premise deployment", body: "Run Gideon entirely inside your infra.", icon: Lock },
] as const;

const testimonials = [
  {
    quote: '"Gideon replaced 12 hours of weekly status syncs. Our exec team got its calendar back."',
    name: "Priya R.",
    role: "COO, Series-B SaaS",
  },
  {
    quote: `"It's not a chatbot. It's the operational layer my company was missing."`,
    name: "James K.",
    role: "Founder & CEO",
  },
  {
    quote: '"Investor updates went from a 4-hour chore to a 5-minute review-and-send."',
    name: "Marcus T.",
    role: "Founder, fintech",
  },
  {
    quote: '"Approval-first AI is the only way enterprise leaders can actually trust automation."',
    name: "Sasha L.",
    role: "Chief of Staff",
  },
] as const;

const faqs = [
  {
    question: "What does Gideon actually do",
    answer:
      "Gideon helps you turn a goal into completed work. Instead of manually researching, writing, coordinating, and following up, Gideon handles those steps for you. For example, if you ask it to raise funding, it can identify relevant investors, prepare outreach, and organize follow-ups, all in one flow.",
  },
  {
    question: "Does Gideon replace my team?",
    answer:
      "No. Gideon is designed to remove coordination overhead so your team can spend more time on decisions, relationships, and execution quality.",
  },
  {
    question: "How does Gideon know what to do?",
    answer:
      "It connects to your systems, learns your company context, and uses your workflows, approvals, and memory to act with the right operating context.",
  },
  {
    question: "What kind of work can I use Gideon for?",
    answer:
      "Investor updates, hiring loops, KPI reporting, sales follow-ups, approvals, research, monitoring, and recurring operating cadences are all strong fits.",
  },
  {
    question: "What do I actually receive as output?",
    answer:
      "You get polished drafts, approval requests, structured reports, synced updates, workflow progress, and saved artifacts inside one workspace.",
  },
] as const;

const footerColumns = [
  {
    title: "Company",
    links: ["About", "Customers", "Careers", "Contact"],
  },
  {
    title: "Product",
    links: ["Overview", "Architecture", "Integrations", "Security"],
  },
  {
    title: "Use Cases",
    links: ["Founder Office", "Investor Relations", "Hiring", "Reporting"],
  },
] as const;

const HERO_TITLE_CLASS =
  "mt-6 max-w-[590px] text-[clamp(3.1rem,7vw,4.35rem)] leading-[0.96] tracking-[-0.05em] text-[#0A0A0A]";
const SECTION_TITLE_CLASS =
  "mt-4 text-[clamp(2.7rem,5vw,3.35rem)] leading-[0.98] tracking-[-0.045em] text-[#0A0A0A]";
const SECTION_BODY_CLASS = "mt-5 text-[17px] leading-[1.72] text-[#6F6F78] lg:text-[18px]";
const CARD_TITLE_CLASS = "mt-4 text-[19px] leading-[1.24] tracking-[-0.03em] text-[#0A0A0A]";
const CARD_BODY_CLASS = "mt-3 text-[15px] leading-7 text-[#525252]";
const SOFT_HOVER_CARD_CLASS =
  "group relative overflow-hidden border border-[rgba(229,229,229,0.8)] transition duration-300 hover:-translate-y-1.5 hover:border-[rgba(91,61,245,0.24)] hover:shadow-[0_22px_48px_-32px_rgba(91,61,245,0.38)]";

function SectionIntro({
  eyebrow,
  title,
  body,
  align = "center",
  accent = true,
  className,
  titleClassName,
  bodyClassName,
  titleWidthClassName = "max-w-[48rem]",
  bodyWidthClassName = "max-w-[42rem]",
}: {
  eyebrow: string;
  title: ReactNode;
  body?: ReactNode;
  align?: "left" | "center" | "right";
  accent?: boolean;
  className?: string;
  titleClassName?: string;
  bodyClassName?: string;
  titleWidthClassName?: string;
  bodyWidthClassName?: string;
}) {
  const alignClass = align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
  const widthAlignment = align === "center" ? "mx-auto" : align === "right" ? "ml-auto" : "";

  return (
    <div className={cn(alignClass, className)}>
      <SectionEyebrow accent={accent}>{eyebrow}</SectionEyebrow>
      <h2 className={cn(outfit.className, SECTION_TITLE_CLASS, titleWidthClassName, widthAlignment, titleClassName)}>
        {title}
      </h2>
      {body ? (
        <p className={cn(inter.className, SECTION_BODY_CLASS, bodyWidthClassName, widthAlignment, bodyClassName)}>
          {body}
        </p>
      ) : null}
    </div>
  );
}

function HeaderNavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="relative py-2 text-[14px] transition duration-300 hover:-translate-y-0.5 hover:text-[#0A0A0A] after:absolute after:bottom-0 after:left-0 after:h-px after:w-full after:origin-left after:scale-x-0 after:bg-[#3525CD] after:transition-transform after:duration-300 hover:after:scale-x-100"
    >
      {children}
    </a>
  );
}

function SectionEyebrow({ children, accent = true }: { children: string; accent?: boolean }) {
  return (
    <p
      className={cn(
        "text-[11px] uppercase tracking-[0.22em]",
        mono.className,
        accent ? "text-[#3525CD]" : "text-[#A3A3A3]",
      )}
    >
      {children}
    </p>
  );
}

function IntegrationRow() {
  const items = [...integrations, ...integrations];

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-[#FAFAFA] to-transparent" />
      <div className="absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-[#FAFAFA] to-transparent" />
      <motion.div
        className="flex min-w-max items-center gap-0"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 26, repeat: Infinity, ease: "linear" }}
      >
        {items.map((label, index) => (
          <div key={`${label}-${index}`} className="flex items-center gap-3 px-10 py-1 text-[#A3A3A3]">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#D4D4D4] bg-white">
              <Circle className="h-2.5 w-2.5 fill-current stroke-none" />
            </span>
            <span className={cn("text-sm", inter.className)}>{label}</span>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

function HeroVisual() {
  return (
    <div className="relative mx-auto flex h-[34rem] w-full max-w-[39.5rem] items-center justify-center lg:h-[39.5625rem]">
      <div className="absolute right-0 top-0 h-[26.25rem] w-[26.25rem] rounded-full bg-[radial-gradient(circle,rgba(91,61,245,0.27)_0%,rgba(91,61,245,0)_70%)] blur-[40px]" />
      <div className="absolute bottom-6 left-0 h-[22.5rem] w-[22.5rem] rounded-full bg-[radial-gradient(circle,rgba(167,139,250,0.3)_0%,rgba(167,139,250,0)_70%)] blur-[45px]" />
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(10,10,10,0.06)_1px,transparent_1px)] bg-[length:24px_24px] opacity-60 [mask-image:radial-gradient(circle_at_center,black_40%,transparent_78%)]" />

      <motion.div
        className="absolute left-[1%] top-[5%] w-[19rem] rounded-xl border border-[#C7C4D8] bg-white shadow-sm"
        initial={{ opacity: 0, y: 18, rotate: -3 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        whileHover={{ y: -6, rotate: -1.5, boxShadow: "0 26px 54px -32px rgba(91,61,245,0.35)" }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-center justify-between border-b border-[#C7C4D8] bg-[#EFF4FF] px-6 py-3">
          <span className={cn("text-[12px] font-semibold uppercase tracking-[0.06em] text-[#464555]", inter.className)}>
            Investor update (sent)
          </span>
          <span className={cn("text-[12px] font-semibold text-[#3525CD]", inter.className)}>Copy</span>
        </div>
        <div className={cn("space-y-3 px-6 py-5 text-[12px] leading-[1.3] text-[#141B2B]", inter.className)}>
          <p>Hi Team,</p>
          <p>
            I&apos;m pleased to share our update for the last period. We&apos;ve seen strong momentum in our core metrics,
            with revenue up 8.2% month over month. This growth continues to compound across pipeline, renewals, and
            execution velocity.
          </p>
        </div>
      </motion.div>

      <motion.div
        className="absolute right-[3%] top-[12%] w-[13.5rem] rounded-xl border border-[#E5E5E5CC] bg-white/70 p-3.5 shadow-[0_18px_40px_-22px_rgba(91,61,245,0.4)] backdrop-blur-md"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -6, scale: 1.015 }}
        transition={{ duration: 0.7, delay: 0.15 }}
      >
        <div className="flex items-center gap-2 text-[11px] font-medium text-[#404040]">
          <BarChart3 className="h-3.5 w-3.5 text-[#3525CD]" />
          Revenue signal
        </div>
        <div className={cn("mt-3 text-[24px] tracking-[-0.03em] text-[#0A0A0A]", outfit.className)}>$284,920</div>
        <div className={cn("mt-1 flex items-center justify-between text-[10px]", inter.className)}>
          <span className="text-[#059669]">▲ 12.4% MoM</span>
          <span className={mono.className + " text-[#A3A3A3]"}>live</span>
        </div>
        <div className="mt-4 flex h-7 items-end gap-[3px]">
          {Array.from({ length: 12 }).map((_, index) => (
            <div
              key={index}
              className="flex-1 rounded-md bg-[#5B3DF5B3]"
              style={{ height: `${36 + ((index * 9) % 28)}%` }}
            />
          ))}
        </div>
      </motion.div>

      <motion.div
        className="absolute bottom-[6%] left-[6%] w-[15rem] rounded-xl border border-[#E5E5E5CC] bg-white/70 p-3.5 shadow-[0_18px_40px_-22px_rgba(91,61,245,0.45)] backdrop-blur-md"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -6, scale: 1.015 }}
        transition={{ duration: 0.7, delay: 0.25 }}
      >
        <div className="flex items-center gap-2 text-[11px] font-medium text-[#404040]">
          <Users className="h-3.5 w-3.5 text-[#3525CD]" />
          Hiring pipeline
        </div>
        <div className="mt-3 space-y-3">
          {[
            { name: "M. Patel", role: "Sr. PM", tag: "Final round", tone: "amber" },
            { name: "S. Choi", role: "Eng Lead", tag: "Offer drafted", tone: "violet" },
          ].map((candidate) => (
            <div key={candidate.name} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <div className="h-5 w-5 rounded-full bg-[#E5E5E5]" />
                <div className={cn("text-[11px]", inter.className)}>
                  <div className="text-[#404040]">{candidate.name}</div>
                  <div className="text-[9px] text-[#A3A3A3]">{candidate.role}</div>
                </div>
              </div>
              <span
                className={cn(
                  "rounded-full border px-2 py-1 text-[9px]",
                  candidate.tone === "amber"
                    ? "border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]"
                    : "border-[#DDD6FE] bg-[#F5F3FF] text-[#6D28D9]",
                )}
              >
                {candidate.tag}
              </span>
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div
        className="absolute bottom-[10%] right-[2%] w-[14rem] rounded-xl border border-[#E5E5E5CC] bg-white/70 p-3.5 shadow-[0_18px_40px_-22px_rgba(91,61,245,0.45)] backdrop-blur-md"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -6, scale: 1.015 }}
        transition={{ duration: 0.7, delay: 0.35 }}
      >
        <div className="flex items-center gap-2 text-[11px] font-medium text-[#404040]">
          <ShieldCheck className="h-3.5 w-3.5 text-[#3525CD]" />
          Approval requested
        </div>
        <p className={cn("mt-3 text-[12px] leading-4 text-[#525252]", inter.className)}>
          Send Q4 board update to 7 investors via email + Notion?
        </p>
        <div className="mt-4 flex gap-2">
          <button className="flex-1 rounded-lg bg-[#0A0A0A] px-3 py-2 text-[10px] text-white">Approve</button>
          <button className="rounded-lg border border-[#E5E5E5] px-3 py-2 text-[10px] text-[#525252]">Edit</button>
        </div>
      </motion.div>

      <div className="absolute left-[22%] top-[48%] rounded-full border border-[#E5E5E5CC] bg-white/70 px-3 py-1.5 text-[10px] text-[#737373] backdrop-blur-md">
        <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-[#10B981]" />
        monitoring 14 systems
      </div>
      <div className="absolute left-[2%] top-[37%] rounded-[10px] border border-[#E5E5E5CC] bg-white/70 px-3 py-1.5 text-[10px] text-[#525252] backdrop-blur-md">
        2 stalled deals · CRM
      </div>
      <div className="absolute right-[5%] top-[55%] rounded-[10px] border border-[#E5E5E5CC] bg-white/70 px-3 py-1.5 text-[10px] text-[#525252] backdrop-blur-md">
        Sync · Stripe ↔ Notion
      </div>

      <motion.div
        className="relative z-10 flex h-[7.5rem] w-[7.75rem] flex-col items-center justify-center rounded-2xl border border-[rgba(91,61,245,0.4)] bg-[linear-gradient(135deg,#0A0A0A_0%,#1A1A1A_100%)] text-center shadow-[0_0_0_1px_rgba(91,61,245,0.3)]"
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      >
        <div className="absolute inset-[-2rem] rounded-full bg-[rgba(91,61,245,0.1)] blur-[24px]" />
        <BrainCircuit className="relative h-5 w-5 text-[#A78BFA]" />
        <div className={cn("relative mt-3 text-base font-medium tracking-[-0.02em] text-white", outfit.className)}>
          Gideon
        </div>
        <div className={cn("relative mt-1 text-[9px] uppercase tracking-[0.16em] text-[#A3A3A3]", mono.className)}>
          core engine
        </div>
      </motion.div>
    </div>
  );
}

function ProblemVisual() {
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_192px_1fr] lg:items-center">
      <div className="relative min-h-[32rem]">
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(239,68,68,0.22)_0%,rgba(239,68,68,0)_72%)] blur-[50px]" />
        <div className="relative">
          <h3 className={cn("pb-4 text-[13px] font-bold uppercase tracking-[0.18em] text-[#EA580C]", inter.className)}>
            Operational Chaos
          </h3>
          <div className="relative h-[28rem]">
            {chaosCards.map((card) => (
              <motion.div
                key={card.title}
                className={cn(
                  "absolute flex h-[4.125rem] w-64 items-center gap-4 rounded-xl border border-[#F1F5F9] bg-white px-3 py-3 shadow-sm transition-shadow duration-300 hover:shadow-[0_18px_42px_-32px_rgba(239,68,68,0.55)]",
                  card.rotate,
                  card.x,
                  card.y,
                )}
                whileHover={{ y: -5, scale: 1.015 }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F8FAFC] text-[#94A3B8]">
                  <FileText className="h-5 w-5" />
                </div>
                <div className={cn("flex-1 text-left", inter.className)}>
                  <div className="text-xs font-semibold text-[#0F172A]">{card.title}</div>
                  <div className="text-[10px] text-[#EF4444]">{card.status}</div>
                </div>
                <div className="h-4 w-4 rounded-full bg-[#EF4444]" />
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      <div className="relative mx-auto flex h-48 w-48 items-center justify-center">
        <div className="absolute inset-[-4rem] rounded-full border border-[rgba(99,102,241,0.05)]" />
        <div className="absolute inset-[-2rem] rounded-full border border-[rgba(99,102,241,0.1)]" />
        <div className="absolute inset-[-1rem] rounded-full bg-[rgba(168,85,247,0.3)] blur-[22px]" />
        <motion.div
          className="absolute inset-0 rounded-full bg-[rgba(99,102,241,0.2)] blur-[34px]"
          animate={{ scale: [0.95, 1.08, 0.95], opacity: [0.45, 0.8, 0.45] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="relative z-10 flex h-48 w-48 flex-col items-center justify-center rounded-full border-4 border-[rgba(129,140,248,0.3)] bg-[linear-gradient(135deg,#4F46E5_0%,#312E81_48%,#000000_100%)] text-white shadow-[0_0_50px_rgba(79,70,229,0.5)]"
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        >
          <div className={cn("text-[30px] font-bold tracking-[-0.03em]", inter.className)}>Gideon</div>
          <div className={cn("mt-3 space-y-1 text-center text-[9px] uppercase tracking-[0.18em] text-[#A5B4FC]", inter.className)}>
            <div>Operational</div>
            <div>Intelligence</div>
            <div>Layer</div>
          </div>
        </motion.div>
      </div>

      <div className="space-y-4 lg:justify-self-end">
        <h3 className={cn("pb-4 text-right text-[13px] font-bold uppercase tracking-[0.18em] text-[#4F46E5]", inter.className)}>
          Operational Coordination
        </h3>
        {coordinationCards.map((card) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.title}
              className="ml-auto flex w-full max-w-sm items-center gap-4 rounded-xl border border-[#F1F5F9] bg-white p-3 shadow-sm transition-shadow duration-300 hover:shadow-[0_18px_42px_-30px_rgba(79,70,229,0.42)]"
              whileHover={{ y: -5, scale: 1.015 }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EEF2FF] text-[#4F46E5]">
                <Icon className="h-5 w-5" />
              </div>
              <div className={cn("flex-1 text-left", inter.className)}>
                <div className="text-xs font-semibold text-[#0F172A]">{card.title}</div>
                <div className="text-[10px] text-[#64748B]">{card.status}</div>
              </div>
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#DCFCE7] text-[#16A34A]">
                <Check className="h-3 w-3" />
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function FAQItem({
  item,
  open,
  onToggle,
}: {
  item: (typeof faqs)[number];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden transition-all duration-300",
        open
          ? "rounded-[20px] bg-[rgba(91,61,245,0.88)] text-white shadow-[0_28px_60px_-38px_rgba(91,61,245,0.6)]"
          : "rounded-lg border border-black bg-white text-[#666666] hover:-translate-y-1 hover:shadow-[0_18px_40px_-32px_rgba(10,10,10,0.28)]",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex w-full items-center justify-between gap-4 px-6 py-5 text-left",
          inter.className,
        )}
        onClick={onToggle}
      >
        <span className={cn("text-[21px] leading-[1.45] capitalize tracking-[-0.02em]", open ? "text-white" : "text-[#666666]")}>
          {item.question}
        </span>
        <motion.span
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full text-lg shadow-sm transition-transform duration-300",
            open ? "bg-white text-[#5B3DF5]" : "bg-[#5B3DF5] text-white",
          )}
          animate={{ rotate: open ? 180 : 0, scale: open ? 1.04 : 1 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
        >
          {open ? "−" : "+"}
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-6">
              <p className={cn("max-w-[56rem] text-[17px] leading-[1.8] text-white/95 lg:text-[18px]", inter.className)}>{item.answer}</p>
              <div className="mt-8 flex items-center justify-between rounded-2xl border border-white/60 bg-white/5 px-8 py-6 backdrop-blur-sm">
                <span className={cn("text-[16px] font-semibold text-white", inter.className)}>Was This Content Helpful ?</span>
                <div className="flex items-center gap-4">
                  <button className="text-white transition hover:opacity-80">👍</button>
                  <button className="text-white transition hover:opacity-80">👎</button>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function LandingPage() {
  const [openFaq, setOpenFaq] = useState(0);

  return (
    <div className={cn("bg-white text-[#0A0A0A]", outfit.variable, inter.variable, mono.variable)}>
      <header className="sticky top-0 z-50 border-b border-[rgba(229,229,229,0.8)] bg-white/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between gap-6 px-5 lg:px-10">
          <Link href="/" className="flex items-center">
            <Image
              src="/logo.svg"
              alt="Gideon"
              width={118}
              height={33}
              className="h-[33px] w-auto"
              priority
            />
          </Link>

          <nav className={cn("hidden items-center gap-8 text-sm text-[#525252] lg:flex", inter.className)}>
            <HeaderNavLink href="#product">Product</HeaderNavLink>
            <HeaderNavLink href="#use-cases">Use Cases</HeaderNavLink>
            <HeaderNavLink href="#integrations">Integrations</HeaderNavLink>
            <HeaderNavLink href="#enterprise">Enterprise</HeaderNavLink>
            <HeaderNavLink href="#faq">Pricing</HeaderNavLink>
          </nav>

          <div className={cn("flex items-center gap-2 text-sm", inter.className)}>
            <Link href="/auth" className="rounded-full px-4 py-2 text-[#404040] transition duration-300 hover:-translate-y-0.5 hover:bg-[#F5F5F5] hover:text-[#0A0A0A]">
              Try Gideon
            </Link>
            <Link href="/auth" className="group inline-flex items-center gap-2 rounded-full bg-[#0A0A0A] px-4 py-2 font-medium text-white shadow-[0_12px_30px_-18px_rgba(10,10,10,0.55)] transition duration-300 hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_20px_36px_-18px_rgba(10,10,10,0.52)]">
              Hire Gideon
              <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 opacity-35 mix-blend-multiply">
            <div className="mx-auto h-full w-full max-w-[1440px] bg-[radial-gradient(circle,rgba(10,10,10,0.08)_1px,transparent_1px)] bg-[length:28px_28px]" />
          </div>
          <div className="absolute right-0 top-20 h-[31.25rem] w-[31.25rem] rounded-full bg-[radial-gradient(circle,rgba(167,139,250,0.3)_0%,rgba(167,139,250,0)_70%)] opacity-70 blur-[45px]" />

          <div className="relative mx-auto flex min-h-[calc(100svh-64px)] w-full max-w-[1321px] items-center px-5 py-16 lg:px-10 lg:py-24">
            <div className="grid w-full items-center gap-16 lg:grid-cols-[minmax(0,590px)_minmax(0,632px)] lg:gap-20">
              <motion.div
                className="max-w-[36.875rem]"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(229,229,229,0.8)] bg-white/70 px-3 py-1.5 backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#3525CD]" />
                  <span className={cn("text-[11px] uppercase tracking-[0.18em] text-[#525252]", mono.className)}>
                    Save 20+ hours of operational work every week
                  </span>
                </div>

                <h1 className={cn(HERO_TITLE_CLASS, outfit.className)}>
                  Your AI CEO that executes, tracks, &amp; thinks with you.
                </h1>

                <p className={cn("mt-6 max-w-[36rem] text-[17px] leading-[1.76] text-[#6F6F78] lg:text-[18px]", inter.className)}>
                  Gideon connects to your systems, understands your business, and handles the operational work,
                  leadership teams shouldn&apos;t spend hours managing manually.
                </p>

                <div className={cn("mt-8 flex flex-wrap items-center gap-3", inter.className)}>
                  <Link
                    href="/auth"
                    className="group inline-flex items-center gap-2 rounded-full bg-[#0A0A0A] px-6 py-3.5 text-sm font-medium text-white shadow-[0_14px_32px_-20px_rgba(10,10,10,0.52)] transition duration-300 hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_22px_42px_-20px_rgba(10,10,10,0.46)]"
                  >
                    Hire Gideon
                    <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </Link>
                  <Link
                    href="/auth"
                    className="group inline-flex items-center gap-2 rounded-full border border-[#D4D4D4] px-6 py-3.5 text-sm font-medium text-[#262626] shadow-sm transition duration-300 hover:-translate-y-0.5 hover:border-[#A3A3A3] hover:bg-white"
                  >
                    Try Gideon
                    <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </Link>

                  <div className="ml-2 flex items-center gap-3 text-xs text-[#737373]">
                    <div className="flex -space-x-2">
                      {["#A78BFA", "#3525CD", "#0A0A0A", "#525252"].map((color) => (
                        <span
                          key={color}
                          className="inline-block h-6 w-6 rounded-full border border-white"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <span className={inter.className}>Trusted by 80+ founder offices</span>
                  </div>
                </div>

                <div className="mt-10 grid max-w-[28rem] grid-cols-3 gap-6">
                  {[
                    { value: "2,000+", label: "Workflows" },
                    { value: "120+", label: "Integrations" },
                    { value: "70%", label: "Overhead cut" },
                  ].map((stat) => (
                    <motion.div key={stat.label} whileHover={{ y: -4 }}>
                      <div className={cn("text-2xl tracking-[-0.03em] text-[#0A0A0A]", outfit.className)}>{stat.value}</div>
                      <div className={cn("mt-1 text-[11px] uppercase tracking-[0.16em] text-[#A3A3A3]", mono.className)}>
                        {stat.label}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>

              <HeroVisual />
            </div>
          </div>
        </section>

        <section className="border-y border-[rgba(229,229,229,0.8)] bg-[linear-gradient(180deg,#FFFFFF_0%,rgba(250,250,250,0.6)_100%)]">
          <div className="mx-auto max-w-[1434px] px-5 py-24 lg:px-10">
            <SectionIntro
              eyebrow="Trusted"
              title="Trusted by operators, startup teams, and founder offices."
              className="mx-auto max-w-[942px]"
              titleWidthClassName="max-w-[58rem]"
              titleClassName="text-[clamp(2.35rem,4vw,2.95rem)]"
            />

            <div className="mt-12 grid gap-4 lg:grid-cols-4">
              {trustMetrics.map((metric) => (
                <motion.div
                  key={metric.label}
                  className={cn(SOFT_HOVER_CARD_CLASS, "rounded-2xl bg-white p-5 shadow-sm")}
                  whileHover={{ y: -6 }}
                >
                  <div className="h-1.5 w-1.5 rounded-full bg-[#3525CD]" />
                  <div className={cn("mt-5 text-[30px] tracking-[-0.03em] text-[#0A0A0A]", outfit.className)}>{metric.value}</div>
                  <div className={cn("mt-2 text-[15px] leading-6 text-[#404040]", inter.className)}>{metric.label}</div>
                  <div className={cn("mt-1 text-[12px] leading-5 text-[#A3A3A3]", inter.className)}>{metric.sublabel}</div>
                </motion.div>
              ))}
            </div>

            <div id="integrations" className="mt-16">
              <div className="text-center">
                <SectionEyebrow accent={false}>Connects with your existing stack</SectionEyebrow>
              </div>
              <div className="mt-6">
                <IntegrationRow />
              </div>
            </div>
          </div>
        </section>

        <section id="use-cases" className="relative overflow-hidden px-5 py-32 lg:px-10">
          <div className="absolute left-1/2 top-0 h-[43.75rem] w-[43.75rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(167,139,250,0.3)_0%,rgba(167,139,250,0)_70%)] opacity-50 blur-[45px]" />
          <div className="relative mx-auto max-w-[1440px]">
            <div className="mx-auto max-w-[1024px] text-center">
              <SectionEyebrow>The problem</SectionEyebrow>
              <div className="mt-5">
                <div className={cn("text-[1.7rem] leading-[1.22] tracking-[-0.03em] text-[#4E4C4C] lg:text-[2rem]", outfit.className)}>
                  Founders don&apos;t burn out from strategy.
                </div>
                <h2 className={cn("mt-3 text-[clamp(2.85rem,6vw,3.7rem)] leading-[0.98] tracking-[-0.045em] text-black", outfit.className)}>
                  They burn out from operational coordination.
                </h2>
              </div>
              <p className={cn("mx-auto mt-7 max-w-[45rem] text-[17px] leading-[1.74] text-[#6F6F78] lg:text-[18px]", inter.className)}>
                As companies grow, leadership teams slowly become the operational layer holding everything together.
                Execution starts depending on follow-ups, approvals, meetings, reporting, workflow tracking, and
                operational coordination.
              </p>
            </div>

            <div className="mt-20">
              <ProblemVisual />
            </div>

            <motion.div
              className="mx-auto mt-24 max-w-[35rem] rounded-2xl border border-[#E0E7FF] bg-[rgba(238,242,255,0.5)] px-8 py-6 shadow-[0_16px_38px_-30px_rgba(79,70,229,0.32)]"
              whileHover={{ y: -5 }}
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#E0E7FF] text-[#4F46E5]">
                  <Sparkles className="h-6 w-6" />
                </div>
                <div className={cn("text-left text-[17px] leading-8 lg:text-[18px]", inter.className)}>
                  <div className="font-semibold text-[#0F172A]">Gideon coordinates the operational layer for you.</div>
                  <div className="font-bold text-[#4338CA]">So leadership can focus on growth, execution, and decisions.</div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <section id="product" className="bg-[linear-gradient(180deg,#FFFFFF_0%,rgba(250,250,250,0.4)_50%,#FFFFFF_100%)] px-5 py-24 lg:px-10">
          <div className="mx-auto max-w-[1046px] text-center">
            <SectionIntro
              eyebrow="Architecture"
              title="Gideon keeps execution moving across your company."
              body="Instead of manually coordinating operations across disconnected systems, Gideon continuously tracks workflows, monitors company signals, prepares operational outputs, and helps leadership teams stay aligned in real time."
              titleWidthClassName="max-w-[56rem]"
              bodyWidthClassName="max-w-[51rem]"
              titleClassName="text-[#3525CD]"
            />
          </div>

          <div className="mx-auto mt-16 max-w-[1130px]">
            <div className="grid gap-8 lg:grid-cols-4">
              {intelligenceCards.map((card, index) => {
                const Icon = card.icon;
                return (
                  <motion.div key={card.title} className="relative" whileHover={{ y: -6 }}>
                    <div
                      className={cn(
                        SOFT_HOVER_CARD_CLASS,
                        "rounded-xl p-5",
                        card.featured
                          ? "border-[rgba(91,61,245,0.4)] bg-[linear-gradient(128deg,rgba(255,255,255,0.4)_1.69%,rgba(53,37,205,0.4)_105.66%)] shadow-[0_30px_70px_-40px_rgba(91,61,245,0.5)]"
                          : "border-[rgba(229,229,229,0.8)] bg-white",
                      )}
                    >
                      <Icon className={cn("h-5 w-5", card.featured ? "text-[#3525CD]" : "text-[#737373]")} />
                      <h3 className={cn(CARD_TITLE_CLASS, "mt-3", outfit.className)}>{card.title}</h3>
                      <ul className={cn("mt-4 space-y-2 text-[13px] leading-6 text-[#525252]", inter.className)}>
                        {card.items.map((item) => (
                          <li key={item} className="flex items-center gap-2">
                            <span className={cn("h-1 w-1 rounded-full", card.featured ? "bg-[#3525CD]" : "bg-[#D4D4D4]")} />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {index < intelligenceCards.length - 1 ? (
                      <div className="absolute -right-6 top-1/2 hidden h-3.5 w-8 -translate-y-1/2 text-[rgba(91,61,245,0.6)] lg:block">
                        <ArrowRight className="h-full w-full" />
                      </div>
                    ) : null}
                  </motion.div>
                );
              })}
            </div>

            <div className="mt-12 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <motion.div className={cn(SOFT_HOVER_CARD_CLASS, "rounded-xl bg-white/70 p-4 backdrop-blur-md")} whileHover={{ y: -6 }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[11px] font-medium text-[#0A0A0A]">
                    <Mail className="h-3.5 w-3.5 text-[#3525CD]" />
                    Investor update · drafted
                  </div>
                  <span className="rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-1 text-[10px] text-[#047857]">
                    Ready for approval
                  </span>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="h-1.5 w-full rounded bg-[#E5E5E5B3]" />
                  <div className="h-1.5 w-[93%] rounded bg-[#E5E5E5B3]" />
                  <div className="h-1.5 w-[80%] rounded bg-[#E5E5E5B3]" />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3">
                  {[
                    ["MRR", "$284k"],
                    ["Burn", "$92k"],
                    ["Runway", "19m"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded border border-[rgba(229,229,229,0.8)] px-3 py-2">
                      <div className={cn("text-[10px] text-[#A3A3A3]", mono.className)}>{label}</div>
                      <div className={cn("mt-1 text-sm tracking-[-0.02em] text-[#262626]", outfit.className)}>{value}</div>
                    </div>
                  ))}
                </div>
              </motion.div>

              <motion.div className={cn(SOFT_HOVER_CARD_CLASS, "rounded-xl bg-white/70 p-4 backdrop-blur-md")} whileHover={{ y: -6 }}>
                <div className="flex items-center gap-2 text-[11px] font-medium text-[#0A0A0A]">
                  <Sparkles className="h-3.5 w-3.5 text-[#3525CD]" />
                  Gideon · daily briefing
                </div>
                <p className={cn("mt-4 text-[13px] leading-6 text-[#525252]", inter.className)}>
                  Revenue trending +12% MoM. Two enterprise deals stalled — drafted re-engagement plays for both.
                  Hiring loop for Senior PM completed; offer pack ready for review.
                </p>
                <div className="mt-5 flex gap-2">
                  <button className="rounded-lg bg-[#0A0A0A] px-4 py-2 text-[11px] text-white transition duration-300 hover:-translate-y-0.5 hover:bg-black">Approve all</button>
                  <button className="rounded-lg border border-[#E5E5E5] px-4 py-2 text-[11px] text-[#525252] transition duration-300 hover:-translate-y-0.5 hover:border-[#C7C7C7] hover:bg-white">Open workspace</button>
                </div>
              </motion.div>

              <motion.div className={cn(SOFT_HOVER_CARD_CLASS, "rounded-xl bg-white/70 p-4 backdrop-blur-md")} whileHover={{ y: -6 }}>
                <div className="flex items-center gap-2 text-[11px] font-medium text-[#0A0A0A]">
                  <BarChart3 className="h-3.5 w-3.5 text-[#F59E0B]" />
                  Operational alerts
                </div>
                <div className={cn("mt-4 space-y-2 text-[11px] text-[#525252]", inter.className)}>
                  <div className="flex items-center justify-between"><span>Stalled deal · Acme</span><span className={mono.className + " text-[#A3A3A3]"}>14d</span></div>
                  <div className="flex items-center justify-between"><span>Hiring offer pending</span><span className={mono.className + " text-[#A3A3A3]"}>2d</span></div>
                  <div className="flex items-center justify-between"><span>Q4 board pack draft</span><span className={mono.className + " text-[#A3A3A3]"}>today</span></div>
                </div>
              </motion.div>

              <motion.div className={cn(SOFT_HOVER_CARD_CLASS, "rounded-xl bg-white/70 p-4 backdrop-blur-md")} whileHover={{ y: -6 }}>
                <div className="flex items-center gap-2 text-[11px] font-medium text-[#0A0A0A]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#3525CD]" />
                  Execution tracker
                </div>
                <div className="mt-4 space-y-4">
                  {[
                    ["Launch pricing v2", 78],
                    ["GTM hiring plan", 45],
                    ["SOC 2 audit", 92],
                  ].map(([label, progress]) => (
                    <div key={label}>
                      <div className={cn("mb-1 flex items-center justify-between text-[10px] text-[#737373]", inter.className)}>
                        <span>{label}</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-1 rounded bg-[#F5F5F5]">
                        <div className="h-1 rounded bg-[#3525CD]" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden px-5 py-32 lg:px-10">
          <div className="absolute left-1/2 top-1/3 h-[37.5rem] w-[37.5rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(167,139,250,0.3)_0%,rgba(167,139,250,0)_70%)] opacity-50 blur-[45px]" />
          <div className="relative mx-auto max-w-[1210px] text-center">
            <SectionIntro
              eyebrow="Intelligence"
              title="Gideon thinks across your entire company."
              body="By connecting your systems, workflows, and operational data, Gideon understands how your business actually operates."
              titleWidthClassName="max-w-[40rem]"
              bodyWidthClassName="max-w-[37rem]"
            />
            <div className="mt-12 grid gap-6 text-left lg:grid-cols-4">
              {[
                {
                  title: "External Systems",
                  body: "Stripe, Slack, HubSpot, docs, finance tools, and the systems your team already uses.",
                  icon: Workflow,
                },
                {
                  title: "Operational Context",
                  body: "Goals, SOPs, reports, templates, and the context that keeps decisions grounded.",
                  icon: FileText,
                },
                {
                  title: "Gideon Intelligence",
                  body: "Memory, reasoning, coordination, drafting, and the layer that connects signals to action.",
                  icon: BrainCircuit,
                },
                {
                  title: "Workflow Execution",
                  body: "Drafts, approvals, notifications, monitoring, and the operational layer that keeps work moving.",
                  icon: Sparkles,
                },
              ].map((card, index) => {
                const Icon = card.icon;
                return (
                  <motion.div
                    key={card.title}
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    whileHover={{ y: -6 }}
                    viewport={{ once: true, amount: 0.3 }}
                    transition={{ duration: 0.45, delay: index * 0.06 }}
                    className={cn(SOFT_HOVER_CARD_CLASS, "rounded-xl bg-white p-5 shadow-sm")}
                  >
                    <Icon className="h-5 w-5 text-[#737373]" />
                    <h3 className={cn(CARD_TITLE_CLASS, outfit.className)}>{card.title}</h3>
                    <p className={cn(CARD_BODY_CLASS, inter.className)}>{card.body}</p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="enterprise" className="border-y border-[rgba(229,229,229,0.8)] bg-[rgba(250,250,250,0.6)] px-5 py-32 lg:px-10">
          <div className="mx-auto max-w-[1124px]">
            <SectionIntro
              eyebrow="Security"
              title="Enterprise-grade security from day one."
              align="left"
              titleWidthClassName="max-w-[48rem]"
            />

            <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {securityCards.map((card) => {
                const Icon = card.icon;
                return (
                  <motion.div key={card.title} className={cn(SOFT_HOVER_CARD_CLASS, "rounded-xl bg-[#F1F5F9] p-5")} whileHover={{ y: -6 }}>
                    <Icon className="h-5 w-5 text-[#3525CD]" />
                    <h3 className={cn(CARD_TITLE_CLASS, "mt-5", outfit.className)}>{card.title}</h3>
                    <p className={cn("mt-2 text-[14px] leading-7 text-[#737373]", inter.className)}>{card.body}</p>
                  </motion.div>
                );
              })}
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              {["SOC 2 Type II", "ISO 27001", "GDPR", "HIPAA-ready"].map((pill) => (
                <div key={pill} className="inline-flex items-center gap-2 rounded-full border border-[rgba(229,229,229,0.8)] bg-white px-3 py-1.5 text-sm text-[#404040] transition duration-300 hover:-translate-y-0.5 hover:border-[rgba(91,61,245,0.22)] hover:shadow-[0_16px_28px_-22px_rgba(91,61,245,0.36)]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#3525CD]" />
                  <span className={inter.className}>{pill}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1280px] px-5 py-32 lg:px-10">
          <SectionIntro
            eyebrow="Operators"
            title="Loved by founders &amp; operating teams."
            align="left"
            titleWidthClassName="max-w-[48rem]"
          />

          <div className="mt-12 grid gap-4 lg:grid-cols-4">
            {testimonials.map((testimonial, index) => (
              <motion.div
                key={testimonial.name}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                whileHover={{ y: -6 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.45, delay: index * 0.05 }}
                className={cn(SOFT_HOVER_CARD_CLASS, "rounded-2xl bg-[#F1F5F9] p-5")}
              >
                <p className={cn("min-h-[6rem] text-[15px] leading-7 text-[#404040]", inter.className)}>{testimonial.quote}</p>
                <div className="mt-5 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full border border-[#E5E5E5] bg-white" />
                  <div className={cn("text-sm", inter.className)}>
                    <div className="font-medium text-[#0A0A0A]">{testimonial.name}</div>
                    <div className="text-[11px] text-[#737373]">{testimonial.role}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="relative overflow-hidden px-5 py-40 lg:px-10">
          <div className="absolute left-1/2 top-1/2 h-[56.25rem] w-[56.25rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(91,61,245,0.45)_0%,rgba(91,61,245,0)_70%)] opacity-60 blur-[40px]" />
          <div className="absolute inset-0 opacity-35 mix-blend-multiply">
            <div className="mx-auto h-full max-w-[1440px] bg-[radial-gradient(circle,rgba(10,10,10,0.08)_1px,transparent_1px)] bg-[length:28px_28px]" />
          </div>

          <div className="relative mx-auto max-w-[896px] text-center">
            <SectionIntro
              eyebrow="Activate"
              title="Stop coordinating operations manually."
              body="Let Gideon handle the operational layer so leadership teams can focus on growth, execution, and decisions."
              titleWidthClassName="max-w-[40rem]"
              bodyWidthClassName="max-w-[39rem]"
              titleClassName="text-[clamp(3rem,7vw,4rem)]"
            />
            <div className={cn("mt-10 flex flex-wrap items-center justify-center gap-3", inter.className)}>
              <Link
                href="/auth"
                className="group inline-flex items-center gap-2 rounded-full bg-[#0A0A0A] px-6 py-3.5 text-sm font-medium text-white shadow-[0_14px_32px_-20px_rgba(10,10,10,0.52)] transition duration-300 hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_22px_42px_-20px_rgba(10,10,10,0.46)]"
              >
                Hire Gideon
                <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
              <Link
                href="/auth"
                className="group inline-flex items-center gap-2 rounded-full border border-[#D4D4D4] bg-white/50 px-6 py-3.5 text-sm font-medium text-[#0A0A0A] shadow-sm transition duration-300 hover:-translate-y-0.5 hover:border-[#A3A3A3] hover:bg-white"
              >
                Book Enterprise Demo
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
            </div>
          </div>
        </section>

        <section id="faq" className="mx-auto w-full max-w-[1028px] px-5 py-24 lg:px-10">
          <div className="text-center">
            <h2 className={cn("text-[clamp(2.9rem,6vw,3.6rem)] font-medium leading-[1.04] tracking-[-0.045em] text-[#222222]", outfit.className)}>
              Frequently Asked Questions
            </h2>
            <p className={cn("mt-4 text-[17px] leading-[1.72] text-[#5F5F68] lg:text-[18px]", inter.className)}>
              Clear answers to how Gideon works and what to expect.
            </p>
          </div>

          <div className="mt-12 space-y-6">
            {faqs.map((item, index) => (
              <FAQItem key={item.question} item={item} open={openFaq === index} onToggle={() => setOpenFaq(openFaq === index ? -1 : index)} />
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-[rgba(229,229,229,0.8)] bg-white">
        <div className="mx-auto grid max-w-[1280px] gap-12 px-5 py-16 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto] lg:px-10">
          <div>
            <div className="flex items-center gap-3">
              <Image src="/logo.svg" alt="Gideon" width={34} height={34} className="rounded-xl" />
              <span className={cn("text-[1.6rem] tracking-[-0.04em] text-[#0A0A0A]", outfit.className)}>Gideon</span>
            </div>
            <p className={cn("mt-4 max-w-[13rem] text-[14px] leading-7 text-[#737373]", inter.className)}>
              Gideon - The operational AI layer for modern companies.
            </p>
          </div>

          {footerColumns.map((column) => (
            <div key={column.title}>
              <SectionEyebrow accent={false}>{column.title}</SectionEyebrow>
              <div className={cn("mt-4 space-y-2 text-sm text-[#404040]", inter.className)}>
                {column.links.map((link) => (
                  <a key={link} href="#" className="block transition duration-300 hover:translate-x-1 hover:text-[#0A0A0A]">
                    {link}
                  </a>
                ))}
              </div>
            </div>
          ))}

          <div>
            <SectionEyebrow accent={false}>Connect</SectionEyebrow>
            <div className={cn("mt-4 space-y-2 text-sm text-[#404040]", inter.className)}>
              {["LinkedIn", "Instagram", "X (Twitter)", "Facebook"].map((item) => (
                <a key={item} href="#" className="flex items-center gap-2 transition duration-300 hover:translate-x-1 hover:text-[#0A0A0A]">
                  <Circle className="h-3 w-3 fill-current stroke-none" />
                  {item}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-[rgba(229,229,229,0.8)]">
          <div className={cn("mx-auto flex max-w-[1280px] flex-col items-start justify-between gap-4 px-5 py-6 text-xs text-[#A3A3A3] md:flex-row md:items-center lg:px-10", inter.className)}>
            <span>© 2026 Gideon. All rights reserved.</span>
            <div className="flex items-center gap-4">
              <a href="#" className="transition hover:text-[#737373]">Privacy</a>
              <a href="#" className="transition hover:text-[#737373]">Terms &amp; condition</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
