"use client";

import { LoaderCircle } from "lucide-react";

import { RightDetailDrawer } from "./RightDetailDrawer";
import { StatusPill } from "./StatusPill";

type ProgressItem = {
  id: string;
  title: string;
  detail: string;
  status: string;
};

type ProgressDrawerProps = {
  open: boolean;
  onClose: () => void;
  items: ProgressItem[];
};

export function ProgressDrawer({ open, onClose, items }: ProgressDrawerProps) {
  return (
    <RightDetailDrawer
      open={open}
      onClose={onClose}
      title="What's running"
      description="Track the work Gideon is currently doing across commands, workflows, and connected tools."
      widthClassName="max-w-lg"
    >
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-3xl border border-border bg-background p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <LoaderCircle className="size-4 text-primary" />
                <p className="font-semibold">{item.title}</p>
              </div>
              <StatusPill status={item.status} />
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.detail}</p>
          </div>
        ))}
      </div>
    </RightDetailDrawer>
  );
}
