"use client";

import Link from "next/link";
import { BellRing, X } from "lucide-react";

import type { GideonNotification } from "@/services/notifications";

import { Button } from "./button";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";
import { RightDetailDrawer } from "./RightDetailDrawer";

type NotificationCenterProps = {
  open: boolean;
  onClose: () => void;
  loading?: boolean;
  notifications: GideonNotification[];
  onClear: (notificationId: string) => void;
  onClearAll: () => void;
};

export function NotificationCenter({
  open,
  onClose,
  loading = false,
  notifications,
  onClear,
  onClearAll,
}: NotificationCenterProps) {
  return (
    <RightDetailDrawer
      open={open}
      onClose={onClose}
      title="Notifications"
      description="Keep up with approvals, completed work, and anything Gideon wants you to review."
      widthClassName="max-w-lg"
    >
      {loading ? (
        <LoadingState label="Loading notifications..." rows={3} />
      ) : notifications.length ? (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={onClearAll}>
              Clear all
            </Button>
          </div>
          {notifications.map((notification) => (
            <div key={notification.id} className="group relative rounded-3xl border border-border bg-background p-4">
              <button
                onClick={() => onClear(notification.id)}
                className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                aria-label="Clear notification"
              >
                <X className="size-3.5" />
              </button>

              <div className="pr-6">
                {notification.actionUrl ? (
                  <Link
                    href={notification.actionUrl}
                    onClick={() => {
                      onClear(notification.id);
                      onClose();
                    }}
                    className="font-semibold hover:underline"
                  >
                    {notification.title}
                  </Link>
                ) : (
                  <p className="font-semibold">{notification.title}</p>
                )}
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {notification.body ?? "No extra detail was provided for this notification."}
                </p>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  {new Date(notification.createdAt).toLocaleString()}
                </span>
                {notification.actionUrl ? (
                  <Link
                    href={notification.actionUrl}
                    onClick={() => {
                      onClear(notification.id);
                      onClose();
                    }}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    View →
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<BellRing className="size-6" />}
          title="Nothing new right now"
          description="New approvals, finished work, and important updates will appear here."
        />
      )}
    </RightDetailDrawer>
  );
}
