"use client";

import { CheckCircle2, Loader2, Database } from "lucide-react";
import { Button } from "@/components/ui/button";

type BulkRow = { op: "create" | "update"; recordId?: string | null; properties?: Record<string, unknown> };

function rowLabel(row: BulkRow): string {
  const props = row.properties ?? {};
  const name = props.name ?? `${props.firstname ?? ""} ${props.lastname ?? ""}`.trim() ?? "";
  return (typeof name === "string" && name) || String(props.email ?? props.domain ?? row.recordId ?? "Record");
}

function rowFields(row: BulkRow): string {
  const props = row.properties ?? {};
  return Object.entries(props)
    .filter(([key]) => !["name", "firstname", "lastname"].includes(key))
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("  ·  ");
}

export function CrmBulkApprovalCard({
  approval,
  messageId,
  defaultStatus,
  onApprove,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  approval: any;
  messageId?: string;
  defaultStatus?: string;
  onEdit?: (approvalId: string) => void;
  onApprove?: (messageId: string, approvalId: string, options?: { retry?: boolean }) => void;
}) {
  const status = approval.status ?? defaultStatus;
  const isExecuted = status === "executed";
  const isExecuting = status === "executing";
  const isFailed = status === "failed";
  const isPendingOrEdited = status === "pending" || status === "edited";

  const preview = approval.preview ?? {};
  const moduleLabel = typeof preview.module === "string" ? preview.module : "records";
  const rows: BulkRow[] = Array.isArray(preview.rows) ? preview.rows : [];
  const createCount = rows.filter((r) => r.op === "create").length;
  const updateCount = rows.length - createCount;

  return (
    <div className="rounded-[1.25rem] border border-border/40 bg-secondary/40 p-5 mt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary/80 flex items-center gap-1.5">
            <Database className="size-3.5" />
            {isExecuted ? "Records written to HubSpot" : `Add ${rows.length} ${moduleLabel} to HubSpot`}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">{approval.title || "Bulk CRM write"}</p>
          {!isExecuted ? (
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {createCount} new · {updateCount} update · {approval.riskLevel} risk — review before writing to HubSpot.
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {isExecuted ? (
            <span className="rounded-full bg-emerald-100 px-4 py-1.5 text-xs font-semibold text-emerald-700">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" />
                Written
              </span>
            </span>
          ) : isExecuting ? (
            <span className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-primary shadow-sm ring-1 ring-border/50 flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" />
              Writing…
            </span>
          ) : isFailed ? (
            <Button size="sm" className="h-8 rounded-full px-4" onClick={() => onApprove?.(messageId || "", approval.id, { retry: true })}>
              Retry write
            </Button>
          ) : isPendingOrEdited ? (
            <Button
              size="sm"
              className="h-8 rounded-full px-4 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => onApprove?.(messageId || "", approval.id)}
            >
              Approve &amp; Write {rows.length}
            </Button>
          ) : null}
        </div>
      </div>

      {!isExecuted && rows.length ? (
        <div className="mt-4 rounded-xl border border-border/50 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border/50 bg-secondary/30">
            <span className="text-sm font-semibold text-foreground">Records to write</span>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-border/40">
            {rows.map((row, index) => (
              <div key={row.recordId ?? index} className="px-4 py-3 flex items-start gap-3">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    row.op === "create" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {row.op === "create" ? "New" : "Update"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{rowLabel(row)}</p>
                  {rowFields(row) ? (
                    <p className="mt-0.5 text-xs text-muted-foreground break-words">{rowFields(row)}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
