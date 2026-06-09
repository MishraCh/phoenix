"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RightDetailDrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  widthClassName?: string;
};

export function RightDetailDrawer({
  open,
  onClose,
  title,
  description,
  children,
  widthClassName,
}: RightDetailDrawerProps) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-40 overflow-hidden transition",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <button
        className={cn(
          "absolute inset-0 bg-slate-900/18 transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
        aria-label="Close drawer"
      />
      <aside
        className={cn(
          "absolute right-0 top-0 h-full w-full max-w-xl translate-x-full border-l border-border bg-white shadow-[0_12px_48px_rgba(15,23,42,0.18)] transition-transform duration-300",
          open && "translate-x-0",
          widthClassName,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            {description ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p> : null}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close drawer">
            <X className="size-4" />
          </Button>
        </div>
        <div className="h-[calc(100%-5.25rem)] overflow-y-auto px-6 py-6">{children}</div>
      </aside>
    </div>
  );
}
