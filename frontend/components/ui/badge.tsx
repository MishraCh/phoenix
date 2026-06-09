import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        success: "border-[hsl(var(--badge-success-border))] bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]",
        warning: "border-[hsl(var(--badge-warning-border))] bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))]",
        danger: "border-[hsl(var(--badge-danger-border))] bg-[hsl(var(--badge-danger-bg))] text-[hsl(var(--badge-danger-text))]",
        running: "border-[hsl(var(--badge-running-border))] bg-[hsl(var(--badge-running-bg))] text-[hsl(var(--badge-running-text))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
