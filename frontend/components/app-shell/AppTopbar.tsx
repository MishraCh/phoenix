"use client";

import Image from "next/image";
import Link from "next/link";
import { Bell, Menu, Plus, Search } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";

import { PlanBadge } from "./PlanBadge";
import { RunningStatusDropdown } from "./RunningStatusDropdown";
import { navItems } from "./navItems";

type AppTopbarProps = {
  pathname: string;
  onOpenNotifications: () => void;
  onOpenMobileNav: () => void;
  unreadCount: number;
};

function getBreadcrumbs(pathname: string) {
  if (pathname === "/command-center" || navItems.some((item) => item.href === pathname)) {
    return [];
  }
  const parent = navItems.find((item) => pathname.startsWith(item.href));
  if (!parent) return [];
  return [parent.title, "Detail"];
}

export function AppTopbar({
  pathname,
  onOpenNotifications,
  onOpenMobileNav,
  unreadCount,
}: AppTopbarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/35 bg-white/80 backdrop-blur-xl">
      <div className="flex h-[4.35rem] items-center gap-4 px-5 md:px-8 xl:px-10">
        <div className="flex shrink-0 items-center gap-3">
          <Button variant="ghost" size="icon" className="xl:hidden" onClick={onOpenMobileNav}>
            <Menu className="size-4" />
            <span className="sr-only">Open navigation</span>
          </Button>

          <Link href="/command-center" className="flex shrink-0 items-center gap-2 rounded-2xl px-1 py-1 transition hover:bg-white/80">
            <Image
              src="/phoenix-ai.png"
              alt="Phoenix AI"
              width={32}
              height={32}
              className="h-8 w-8 object-contain"
              priority
            />
            <span className="hidden text-[1.05rem] font-semibold tracking-[-0.03em] text-foreground sm:inline">
              Phoenix <span className="text-primary">AI</span>
            </span>
          </Link>
        </div>

        {/* ── Center: command / search bar ──────────────────────────── */}
        <div className="flex flex-1 items-center justify-center">
          <Link
            href="/command-center"
            className="group flex h-11 w-full max-w-[38rem] items-center gap-3 rounded-full border border-border/55 bg-white/85 px-4 text-sm text-muted-foreground shadow-[0_2px_8px_rgba(30,20,80,0.02)] transition-all duration-200 hover:border-primary/35 hover:bg-white hover:shadow-sm md:max-w-[52rem]"
          >
            <Search className="size-4 shrink-0 opacity-50 group-hover:opacity-70" />
            <span className="min-w-0 flex-1 truncate">Ask Gideon, search, or start something new…</span>
            <kbd className="ml-1 hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-secondary/80 px-2 py-0.5 font-sans text-[11px] font-semibold text-muted-foreground sm:flex">
              Ctrl K
            </kbd>
          </Link>
        </div>

        {/* ── Right: action controls ─────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-2">

          {/* Plan */}
          <PlanBadge />

          {/* New */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="h-9 gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_14px_30px_-18px_rgba(53,37,205,0.65)] hover:bg-primary/90">
                <Plus className="size-3.5" />
                <span>New</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8}>
              <DropdownMenuLabel>Create</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/workflows">Workflow</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/library">Library note</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/context">Context update</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Running */}
          <RunningStatusDropdown />

          {/* Notifications */}
          <Button
            aria-label="Notifications"
            size="icon"
            variant="outline"
            className="relative size-9 rounded-full border-border/60 bg-white/90 shadow-none hover:border-primary/30 hover:bg-muted/40"
            onClick={onOpenNotifications}
          >
            <Bell className="size-4" />
            {unreadCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex min-w-[1.1rem] items-center justify-center rounded-full bg-primary px-0.5 py-px text-[9px] font-semibold leading-none text-primary-foreground">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </Button>

        </div>
      </div>
    </header>
  );
}
