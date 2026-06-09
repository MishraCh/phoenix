"use client";

type LoadingStateProps = {
  label?: string;
  rows?: number;
};

export function LoadingState({ label, rows = 3 }: LoadingStateProps) {
  return (
    <div className="space-y-3">
      {label ? (
        <p className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary/60" />
          {label}
        </p>
      ) : null}
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="rounded-[1.5rem] border border-border/45 bg-white/90 p-4 shadow-[0_10px_28px_-24px_rgba(30,20,80,0.28)]"
          style={{ animationDelay: `${index * 80}ms` }}
        >
          {/* Icon + title row */}
          <div className="flex items-center gap-3">
            <div className="skeleton size-8 rounded-xl" />
            <div className="flex-1 space-y-1.5">
              <div className="skeleton h-3 w-2/5" />
              <div className="skeleton h-2.5 w-1/4" />
            </div>
            <div className="skeleton h-5 w-14 rounded-full" />
          </div>
          {/* Body lines */}
          <div className="mt-3 space-y-2">
            <div className="skeleton h-2.5 w-full" style={{ animationDelay: `${index * 80 + 60}ms` }} />
            <div className="skeleton h-2.5 w-4/5" style={{ animationDelay: `${index * 80 + 120}ms` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
