"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { NotificationCenter } from "@/components/ui/NotificationCenter";
import { useToast } from "@/components/ui/ToastProvider";
import { useAuth } from "@/hooks/useAuth";
import { gideonQueryKeys, useNotificationsQuery, useDashboardSummaryQuery } from "@/hooks/useGideonQueries";
import { emptyDashboardSummary } from "@/services/dashboard";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getFriendlyErrorMessage } from "@/lib/product";
import { clearAllNotifications, clearNotification } from "@/services/notifications";

import { AppSidebar } from "./AppSidebar";
import { AppTopbar } from "./AppTopbar";
import { SseEventHandler } from "./SseEventHandler";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname() || "/";
  const [collapsed, setCollapsed] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const queryClient = useQueryClient();
  const { idToken } = useAuth();
  const notificationsQuery = useNotificationsQuery({ enabled: notificationsOpen });
  const { pushToast } = useToast();
  const notifications = notificationsQuery.data?.notifications ?? [];
  // Always enabled so the unread badge count is current without opening the drawer
  const dashboardQuery = useDashboardSummaryQuery();
  const summary = dashboardQuery.data ?? emptyDashboardSummary;
  const unreadCount = summary.unreadNotificationCount;

  async function handleClear(notificationId: string) {
    if (!idToken) return;

    // Optimistically remove from cache immediately
    queryClient.setQueryData(
      gideonQueryKeys.notifications(idToken),
      (current: typeof notificationsQuery.data) =>
        current
          ? { ...current, notifications: current.notifications.filter((n) => n.id !== notificationId) }
          : current,
    );
    queryClient.setQueryData(
      gideonQueryKeys.dashboardSummary(idToken),
      (current: typeof dashboardQuery.data) =>
        current
          ? { ...current, unreadNotificationCount: Math.max(0, (current.unreadNotificationCount || 0) - 1) }
          : current,
    );

    try {
      await clearNotification(idToken, notificationId);
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.dashboardSummary(idToken) });
    } catch (error) {
      // Roll back on failure
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.notifications(idToken) });
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.dashboardSummary(idToken) });
      pushToast({
        title: "Couldn't clear notification",
        description: getFriendlyErrorMessage(error, "Try again in a moment."),
        tone: "error",
      });
    }
  }

  async function handleClearAll() {
    if (!idToken) return;

    // Optimistically clear the list immediately
    queryClient.setQueryData(
      gideonQueryKeys.notifications(idToken),
      (current: typeof notificationsQuery.data) =>
        current ? { ...current, notifications: [] } : current,
    );
    queryClient.setQueryData(
      gideonQueryKeys.dashboardSummary(idToken),
      (current: typeof dashboardQuery.data) =>
        current ? { ...current, unreadNotificationCount: 0 } : current,
    );

    try {
      await clearAllNotifications(idToken);
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.dashboardSummary(idToken) });
    } catch (error) {
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.notifications(idToken) });
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.dashboardSummary(idToken) });
      pushToast({
        title: "Couldn't clear notifications",
        description: getFriendlyErrorMessage(error, "Try again in a moment."),
        tone: "error",
      });
    }
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="relative flex min-h-screen h-[100dvh] flex-col overflow-clip bg-[linear-gradient(180deg,hsl(240,38%,98%)_0%,hsl(236,42%,97%)_48%,hsl(240,30%,98%)_100%)] text-foreground">
        <div
          className="pointer-events-none absolute -left-44 -top-44 size-[620px] rounded-full opacity-25 animate-float"
          style={{
            background: "radial-gradient(circle, hsl(252,85%,90%), transparent 72%)",
            filter: "blur(90px)",
          }}
        />
        <div
          className="pointer-events-none absolute -bottom-24 -right-24 size-[560px] rounded-full opacity-15 animate-float"
          style={{
            background: "radial-gradient(circle, hsl(240,80%,88%), transparent 72%)",
            filter: "blur(96px)",
            animationDelay: "-2s",
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.35)_0%,rgba(255,255,255,0)_18%,rgba(91,61,245,0.02)_100%)]" />

        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <AppTopbar
            pathname={pathname}
            onOpenNotifications={() => setNotificationsOpen(true)}
            onOpenMobileNav={() => setMobileNavOpen(true)}
            unreadCount={unreadCount}
          />

          <div className="flex min-h-0 flex-1 gap-3 overflow-hidden px-3 pt-3 pb-0 md:px-5 md:pt-4 md:pb-0">
            <AppSidebar
              collapsed={collapsed}
              onToggle={() => setCollapsed((value) => !value)}
              pathname={pathname}
            />

            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-t-shell rounded-b-none border border-border/45 border-b-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(252,252,255,0.96)_100%)] px-5 py-5 shadow-panel backdrop-blur-xl md:px-7 md:py-6">
              {children}
            </main>
          </div>
        </div>

        <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <DialogContent className="left-4 top-4 flex h-[calc(100vh-2rem)] max-w-[22rem] translate-x-0 translate-y-0 p-0">
            <DialogTitle className="sr-only">Navigation Menu</DialogTitle>
            <div className="w-full p-4">
              <AppSidebar mobile collapsed={false} onToggle={() => setMobileNavOpen(false)} pathname={pathname} />
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <NotificationCenter
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        loading={notificationsQuery.isLoading && !notificationsQuery.data}
        notifications={notifications}
        onClear={handleClear}
        onClearAll={handleClearAll}
      />
      <SseEventHandler />
    </TooltipProvider>
  );
}
