"use client";

import { AlertTriangle, Database, Mail, Search, Users } from "lucide-react";

import type { IntegrationRecordsResult } from "@/services/command";

function providerIcon(provider: string) {
  if (provider === "gmail") return Mail;
  if (provider === "hubspot") return Users;
  return Database;
}

function statusCopy(status?: string) {
  switch (status) {
    case "multiple_matches":
      return { label: "Multiple matches", tone: "amber" };
    case "empty":
    case "not_found":
      return { label: "No match", tone: "muted" };
    case "disconnected":
      return { label: "Reconnect needed", tone: "amber" };
    case "error":
      return { label: "Unavailable", tone: "red" };
    default:
      return { label: "Live records", tone: "green" };
  }
}

export function IntegrationRecordsCard({ result }: { result: IntegrationRecordsResult }) {
  const records = result.records ?? [];
  const Icon = providerIcon(result.provider);
  const status = statusCopy(result.status);
  const isEmpty = records.length === 0;

  return (
    <section className="max-w-[58rem] overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              {result.provider} {result.module ? `· ${result.module}` : ""}
            </p>
            <h3 className="mt-1 text-[16px] font-semibold tracking-tight text-foreground">
              {result.summary || (isEmpty ? "No records found" : "Records found")}
            </h3>
            {result.query ? (
              <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Search className="size-3.5" />
                {result.query}
              </p>
            ) : null}
          </div>
        </div>
        <span
          className={[
            "rounded-full px-2.5 py-1 text-[11px] font-semibold",
            status.tone === "green"
              ? "bg-emerald-50 text-emerald-800"
              : status.tone === "amber"
                ? "bg-amber-50 text-amber-800"
                : status.tone === "red"
                  ? "bg-red-50 text-red-700"
                  : "bg-muted text-muted-foreground",
          ].join(" ")}
        >
          {status.label}
        </span>
      </div>

      {isEmpty ? (
        <div className="flex items-start gap-3 px-5 py-5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-[14px] font-medium text-foreground">
              I could not find a grounded record for that request.
            </p>
            <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
              Try a more specific name, email, company domain, or select the record from the workspace.
            </p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {records.slice(0, 12).map((record, index) => (
            <div key={`${record.id}-${index}`} className="grid gap-2 px-5 py-3 md:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-foreground">{record.title}</p>
                {record.subtitle ? (
                  <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                    {record.subtitle}
                  </p>
                ) : null}
              </div>
              {record.id ? (
                <p className="self-start rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                  {record.id}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {result.availableActions?.length ? (
        <div className="flex flex-wrap gap-1.5 border-t border-border/60 bg-muted/20 px-5 py-3">
          {result.availableActions.slice(0, 5).map((action) => (
            <span
              key={action}
              className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] font-medium text-foreground/70"
            >
              {action}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
