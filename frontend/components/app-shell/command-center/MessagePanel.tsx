"use client";

import { useState } from "react";
import { AlertCircle, Bot, Check, Copy, FolderPlus, Loader2, Sparkles } from "lucide-react";

import { StatusPill } from "@/components/ui/StatusPill";
import type { CommandMode } from "@/services/command";

import { CommandResponseBody } from "./CommandResponseBody";
import { LiveApprovalCard } from "./LiveApprovalCard";
import { modeLabel } from "./types";
import type { SessionMessage } from "./types";

type MessagePanelProps = {
  message: SessionMessage;
  onOpenDetails: (messageId: string) => void;
  onApproveApproval: (messageId: string, approvalId: string, options?: { retry?: boolean }) => void;
  onEditApproval: (approvalId: string) => void;
  onToggleStar: (messageId: string, assistantMessageId: string, starred: boolean) => void | Promise<void>;
  onSaveResponse: (messageId: string, assistantMessageId: string) => void | Promise<void>;
  onCreateArtifact: (
    messageId: string,
    assistantMessageId: string,
    input: { title?: string; artifactType: "report" | "draft" | "summary" | "data" | "document" },
  ) => void | Promise<void>;
  /** expertType of the immediately preceding assistant message, for accent continuity */
  prevExpertType?: string | null;
};

function cleanErrorMessage(raw: string): string {
  if (!raw) return "Something went wrong. Please try again.";
  if (raw.includes("polling budget") || raw.includes("TIMEOUT") || raw.includes("timed out"))
    return "Research is taking longer than usual right now. Try a more specific question, or use /search for faster results.";
  if (raw.includes("UNAUTHORIZED") || raw.includes("401"))
    return "Your session expired. Please refresh the page and try again.";
  if (raw.includes("credits") || raw.includes("limit"))
    return "You've reached your usage limit for this period. Upgrade your plan to continue.";
  if (raw.includes("rate limit") || raw.includes("429"))
    return "Gideon is handling a lot right now. Please wait a moment and retry.";
  return raw;
}

const MODE_COLORS: Record<string, string> = {
  search: "border-sky-200 bg-sky-50 text-sky-700",
  research: "border-violet-200 bg-violet-50 text-violet-700",
  extract_url:
    "border-[hsl(var(--badge-warning-border))] bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))]",
  workflow:
    "border-[hsl(var(--badge-success-border))] bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]",
};

export function MessagePanel({
  message,
  onOpenDetails,
  onApproveApproval,
  onEditApproval,
  onToggleStar,
  onSaveResponse,
  onCreateArtifact,
  prevExpertType,
}: MessagePanelProps) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasDetails =
    message.response &&
    (message.response.sources.length > 0 ||
      message.response.missingContext.length > 0 ||
      message.response.createdArtifact ||
      message.response.createdApproval ||
      message.response.createdWorkflow);

  const modeCls =
    message.mode !== "auto"
      ? MODE_COLORS[message.mode as string] ?? "border-primary/20 bg-primary/5 text-primary"
      : null;
  const createdApproval = message.response?.createdApproval ?? null;
  const approvalStatus = createdApproval?.status ?? "pending";
  const assistantMessageId = message.assistantMessageId;

  async function handleCopy() {
    if (!message.response?.answer) return;
    await navigator.clipboard.writeText(message.response.answer);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function handleSaveClick() {
    if (!assistantMessageId || message.savedItemId) return;
    setSaving(true);
    try {
      await onSaveResponse(message.id, assistantMessageId);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex justify-end">
        <div className="max-w-[70%]">
          <div className="mb-1.5 flex items-center justify-end gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">You</span>
          </div>
          <div className="rounded-[1.1rem] rounded-tr-sm border border-primary/15 bg-[hsl(var(--primary)_/_0.96)] px-4 py-2.5 text-[13px] leading-6 text-primary-foreground shadow-sm shadow-primary/15">
            {message.userQuery}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3">
        <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/[0.08] text-primary">
          <Sparkles className="size-3.5" />
        </div>

        <div className="min-w-0 max-w-[52rem] flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-foreground/62">Gideon</span>
            <StatusPill status={message.status} />
            {modeCls ? (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${modeCls}`}>
                {modeLabel(message.mode as Exclude<CommandMode, "auto">)}
              </span>
            ) : null}
            {message.agentName ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/55 bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                <Bot className="size-3 text-primary/65" />
                {message.agentName}
              </span>
            ) : null}
          </div>

          {message.status === "running" ? (
            <div className="space-y-3 rounded-xl bg-background/80 px-3 py-3">
              {message.statusCopy ? (
                <p className="flex items-center gap-2 text-xs font-medium text-primary/85">
                  <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
                  {message.statusCopy}
                </p>
              ) : null}
              <div className="space-y-2.5">
                <div className="h-2.5 w-3/4 animate-pulse rounded-full bg-primary/10" />
                <div className="h-2.5 w-full animate-pulse rounded-full bg-primary/7" style={{ animationDelay: "120ms" }} />
                <div className="h-2.5 w-5/6 animate-pulse rounded-full bg-primary/6" style={{ animationDelay: "240ms" }} />
              </div>
            </div>
          ) : message.status === "error" ? (
            <div className="flex items-start gap-3 rounded-xl border border-destructive/15 bg-destructive/4 px-4 py-3">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive/70" />
              <p className="text-sm leading-relaxed text-destructive/82">{cleanErrorMessage(message.statusCopy ?? "")}</p>
            </div>
          ) : message.status === "completed" && message.response ? (
            <div className="space-y-3">
              <CommandResponseBody
                response={message.response}
                hasDetails={!!hasDetails}
                onOpenDetails={() => onOpenDetails(message.id)}
                approvalStatus={approvalStatus}
                onEditApproval={onEditApproval}
                onApproveApproval={onApproveApproval}
                messageId={message.id}
                prevExpertType={prevExpertType}
              />
              <div className="flex flex-wrap items-center gap-2 border-t border-border/30 pt-2.5 mt-1">
                <button
                  type="button"
                  onClick={handleSaveClick}
                  disabled={!assistantMessageId || !!message.savedItemId || saving}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:border-foreground/20 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : message.savedItemId ? (
                    <Check className="size-3 text-emerald-600" />
                  ) : (
                    <FolderPlus className="size-3" />
                  )}
                  {message.savedItemId ? "Saved to library" : "Save to library"}
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!message.response?.answer}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:border-foreground/20 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              {createdApproval && !createdApproval.actionType?.startsWith("hubspot_") ? (
                <LiveApprovalCard
                  approvalId={createdApproval.approvalId}
                  messageId={message.id}
                  defaultLabel={createdApproval.label}
                  defaultRiskLevel={createdApproval.riskLevel}
                  defaultStatus={approvalStatus}
                  onEdit={onEditApproval}
                  onApprove={onApproveApproval}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
