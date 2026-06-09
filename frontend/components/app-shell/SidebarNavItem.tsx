"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type SidebarNavItemProps = {
  href: string;
  title: string;
  icon: LucideIcon;
  active: boolean;
  collapsed: boolean;
};

export function SidebarNavItem({
  href,
  title,
  icon: Icon,
  active,
  collapsed,
}: SidebarNavItemProps) {
  const content = (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
        "text-muted-foreground",
        "hover:bg-white hover:text-foreground hover:shadow-[0_8px_20px_-18px_rgba(15,23,42,0.3)]",
        active && "font-semibold text-primary",
        collapsed && "justify-center px-2",
      )}
    >
      {active ? (
        <motion.span
          layoutId="gideon-active-nav"
          className="absolute inset-0 rounded-2xl border border-primary/10 bg-[linear-gradient(180deg,rgba(91,61,245,0.12)_0%,rgba(91,61,245,0.05)_100%)] shadow-[0_14px_28px_-24px_rgba(53,37,205,0.6)]"
          transition={{ type: "spring", stiffness: 400, damping: 35 }}
        />
      ) : null}
      {active && !collapsed ? (
        <span className="absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
      ) : null}
      <Icon
        className={cn(
          "relative z-10 size-4 shrink-0 transition-colors",
          active ? "text-primary" : "text-muted-foreground",
        )}
      />
      {!collapsed ? <span className="relative z-10">{title}</span> : null}
    </Link>
  );

  if (!collapsed) {
    return content;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="right">{title}</TooltipContent>
    </Tooltip>
  );
}
