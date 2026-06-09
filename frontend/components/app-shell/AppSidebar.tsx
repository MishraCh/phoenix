"use client";

import { LogOut, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

import { mainNavItems } from "./navItems";
import { SidebarNavItem } from "./SidebarNavItem";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

type AppSidebarProps = {
  collapsed: boolean;
  mobile?: boolean;
  onToggle: () => void;
  pathname: string;
};

export function AppSidebar({ collapsed, mobile = false, onToggle, pathname }: AppSidebarProps) {
  const { signOut } = useAuth();

  return (
    <aside
      className={cn(
        mobile
          ? "h-full w-full"
          : "hidden h-full shrink-0 xl:block",
        mobile ? "w-full" : collapsed ? "w-[5.5rem]" : "w-[17.75rem]",
      )}
    >
      <div className="relative h-full">
        <div className="flex h-full flex-col rounded-[2rem] border border-border/45 bg-[linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(248,248,253,0.96)_100%)] px-3 py-3 shadow-[0_18px_38px_-28px_rgba(30,20,80,0.22)] backdrop-blur-xl">
          <div className={cn("flex items-center justify-end px-1", collapsed && "hidden")}>
            <Button
              aria-label="Collapse sidebar"
              size="icon"
              variant="ghost"
              className="rounded-full text-muted-foreground/60 hover:bg-white hover:text-foreground hover:shadow-sm"
              onClick={onToggle}
            >
              <PanelLeftClose className="size-4" />
            </Button>
          </div>

          <div className={cn("mt-3", collapsed ? "px-0" : "px-1")}>
            <WorkspaceSwitcher collapsed={collapsed} />
          </div>

          <nav className={cn("mt-4 flex flex-1 flex-col gap-0.5", collapsed && "items-center")}>
            {mainNavItems.map((item) => (
              <SidebarNavItem
                key={item.href}
                href={item.href}
                title={item.title}
                icon={item.icon}
                active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                collapsed={collapsed}
              />
            ))}

            <Separator className="my-3 bg-border/45" />

            <div className={cn("mt-auto flex flex-col gap-0.5", collapsed && "items-center")}>
              <SidebarNavItem
                href="/settings"
                title="Settings"
                icon={Settings}
                active={pathname.startsWith("/settings")}
                collapsed={collapsed}
              />

              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-2xl text-muted-foreground/70 hover:bg-white hover:text-foreground hover:shadow-sm"
                      onClick={() => void signOut()}
                    >
                      <LogOut className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Sign out</TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  variant="ghost"
                  className="justify-start rounded-2xl px-3 py-2 text-sm font-medium text-muted-foreground/70 hover:bg-white hover:text-foreground hover:shadow-sm"
                  onClick={() => void signOut()}
                >
                  <LogOut className="mr-3 size-4" />
                  Sign out
                </Button>
              )}
            </div>
          </nav>
        </div>

        {collapsed ? (
          <Button
            size="icon"
            className="absolute -right-4 top-10 rounded-full border border-border/60 bg-white text-foreground shadow-panel hover:bg-secondary/60"
            onClick={onToggle}
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen className="size-4" />
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
