"use client";

import type { CommandSourceRef } from "@/services/command";

type SourceChipsProps = {
  sources: CommandSourceRef[];
};

export function SourceChips({ sources }: SourceChipsProps) {
  if (!sources.length) {
    return <p className="text-sm text-muted-foreground">No sources linked yet.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((source, index) => {
        const label = source.title ?? source.sourceType ?? source.sourceId ?? `Source ${index + 1}`;
        const meta = [source.provider, source.freshness, typeof source.confidence === "number" ? `${Math.round(source.confidence * 100)}%` : null]
          .filter(Boolean)
          .join(" • ");
        const chipLabel = meta ? `${label} • ${meta}` : label;

        if (source.url) {
          return (
            <a
              key={`${label}-${index}`}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition hover:border-primary hover:text-foreground"
            >
              {chipLabel}
            </a>
          );
        }

        return (
          <span
            key={`${label}-${index}`}
            className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground"
          >
            {chipLabel}
          </span>
        );
      })}
    </div>
  );
}
