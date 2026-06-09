"use client";

import { Check, LoaderCircle, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type StepStatus = "pending" | "running" | "done" | "error";

export type Step = {
  label: string;
  status: StepStatus;
};

type StepProgressLoaderProps = {
  steps: Step[];
  className?: string;
};

export function StepProgressLoader({ steps, className }: StepProgressLoaderProps) {
  return (
    <div className={cn("relative ml-3 space-y-0", className)}>
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        return (
          <div key={i} className="flex gap-3">
            {/* Timeline line + dot */}
            <div className="relative flex flex-col items-center">
              <StepDot status={step.status} />
              {!isLast && (
                <div
                  className={cn(
                    "mt-1 w-px flex-1",
                    step.status === "done" ? "bg-success/40" : "bg-border/60",
                  )}
                  style={{ minHeight: "1.5rem" }}
                />
              )}
            </div>

            {/* Label */}
            <p
              className={cn(
                "pb-5 pt-0.5 text-sm leading-5",
                step.status === "running" && "font-medium text-foreground",
                step.status === "done" && "text-muted-foreground",
                step.status === "pending" && "text-muted-foreground/60",
                step.status === "error" && "text-destructive",
              )}
            >
              {step.label}
              {step.status === "running" && (
                <span className="ml-2 inline-flex gap-0.5">
                  {[0, 1, 2].map((dot) => (
                    <span
                      key={dot}
                      className="inline-block size-1 rounded-full bg-primary animate-pulse"
                      style={{ animationDelay: `${dot * 200}ms` }}
                    />
                  ))}
                </span>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function StepDot({ status }: { status: StepStatus }) {
  if (status === "running") {
    return (
      <div className="relative flex size-5 shrink-0 items-center justify-center">
        <span className="absolute size-5 rounded-full bg-primary/20 animate-ping" />
        <LoaderCircle className="relative size-3.5 animate-spin text-primary" />
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success">
        <Check className="size-3 text-white" strokeWidth={3} />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-destructive bg-destructive/10">
        <X className="size-3 text-destructive" strokeWidth={3} />
      </div>
    );
  }

  // pending
  return (
    <div className="size-5 shrink-0 rounded-full border-2 border-border bg-background" />
  );
}
