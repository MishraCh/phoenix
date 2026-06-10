"use client";

import Link from "next/link";
import { ArrowUpRight, CreditCard, Crown, Sparkles, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/hooks/useWorkspace";

const PLAN_META = {
  free: {
    label: "Free",
    caption: "1 seat · 50 credits/mo · 1 integration",
  },
  plus: {
    label: "Plus",
    caption: "3 seats · 1,500 credits/mo · 3 integrations",
  },
  pro: {
    label: "Pro",
    caption: "10 seats · 7,500 credits/mo · 8 integrations",
  },
} as const;

export function PlanBadge() {
  const { selectedWorkspace } = useWorkspace();
  const plan = selectedWorkspace?.plan ?? "free";
  const meta = PLAN_META[plan];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {plan === "free" ? (
          <Button
            variant="outline"
            className="h-9 gap-1.5 rounded-full border-primary/30 bg-primary/5 px-3.5 text-sm font-semibold text-primary shadow-none transition hover:border-primary/50 hover:bg-primary/10"
          >
            <Sparkles className="size-3.5" />
            <span>Upgrade</span>
          </Button>
        ) : plan === "plus" ? (
          <Button
            variant="outline"
            className="h-9 gap-1.5 rounded-full border-primary/25 bg-primary/10 px-3.5 text-sm font-semibold text-primary shadow-none hover:bg-primary/15"
          >
            <Zap className="size-3.5" />
            <span>Plus</span>
          </Button>
        ) : (
          <Button className="h-9 gap-1.5 rounded-full bg-[#0A0A0A] px-3.5 text-sm font-semibold text-white shadow-none hover:bg-[#262626]">
            <Crown className="size-3.5" />
            <span>Pro</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <DropdownMenuLabel>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current plan</span>
          <p className="mt-0.5 text-sm font-semibold text-foreground">{meta.label}</p>
          <p className="mt-0.5 text-xs font-normal text-muted-foreground">{meta.caption}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {plan !== "pro" ? (
          <DropdownMenuItem asChild>
            <Link href="/settings?tab=billing" className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <span className="flex-1">{plan === "free" ? "Upgrade plan" : "Upgrade to Pro"}</span>
              <ArrowUpRight className="size-3.5 text-muted-foreground" />
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=billing" className="flex items-center gap-2">
            <CreditCard className="size-4 text-muted-foreground" />
            <span className="flex-1">Billing &amp; plan</span>
            <ArrowUpRight className="size-3.5 text-muted-foreground" />
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
