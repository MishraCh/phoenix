import { motion } from "framer-motion";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ProductHeaderProps = {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  variant?: "default" | "compact" | "builder";
  className?: string;
};

const variantStyles = {
  default: {
    wrap: "gap-4",
    title: "mt-2 text-[2.1rem] font-semibold tracking-[-0.06em] text-foreground md:text-[2.45rem]",
    description: "mt-3 max-w-3xl text-[0.98rem] leading-7 text-muted-foreground md:text-[1.03rem]",
  },
  compact: {
    wrap: "gap-3",
    title: "mt-1.5 text-[1.6rem] font-semibold tracking-[-0.05em] text-foreground md:text-[1.85rem]",
    description: "mt-2 max-w-3xl text-sm leading-6 text-muted-foreground",
  },
  builder: {
    wrap: "gap-4",
    title: "mt-2 text-[1.9rem] font-semibold tracking-[-0.055em] text-foreground md:text-[2.15rem]",
    description: "mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-[0.98rem]",
  },
} as const;

export function ProductHeader({
  eyebrow,
  title,
  description,
  action,
  actions,
  meta,
  variant = "default",
  className,
}: ProductHeaderProps) {
  const rightContent = actions ?? action;
  const styles = variantStyles[variant];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn("flex flex-wrap items-start justify-between", styles.wrap, className)}
    >
      <div className="max-w-3xl">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/85">{eyebrow}</p>
        ) : null}
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>
        {meta ? <div className="mt-4">{meta}</div> : null}
      </div>
      {rightContent ? <div className="shrink-0 pt-1">{rightContent}</div> : null}
    </motion.div>
  );
}
