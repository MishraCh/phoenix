"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BellRing,
  Bot,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileOutput,
  GitBranch,
  GitFork,
  Globe,
  Layers,
  LayoutList,
  Loader2,
  Network,
  Pause,
  Play,
  Plus,
  Radar,
  Timer,
  Trash2,
  X,
  Zap,
} from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageErrorBoundary } from "@/components/ui/PageErrorBoundary";
import { RightDetailDrawer } from "@/components/ui/RightDetailDrawer";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import {
  gideonQueryKeys,
  useAgentsQuery,
  useWorkflowDetailQuery,
  useWorkflowRunsQuery,
  useWorkflowsQuery,
} from "@/hooks/useGideonQueries";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { getFriendlyErrorMessage } from "@/lib/product";
import {
  cancelWorkflowRun,
  createWorkflow,
  deleteWorkflow,
  fetchWorkflowPlaceholders,
  fetchWorkflowRun,
  runWorkflow,
  saveWorkflow,
  updateWorkflowStatus,
  type WorkflowListItem,
  type WorkflowRunDetail,
  type WorkflowRunListItem,
  type WorkflowStep,
} from "@/services/workflows";

import { ProductHeader } from "./ProductHeader";
import { WorkflowCanvasView } from "./WorkflowCanvas";
import { useWorkspaceStream } from "@/hooks/useWorkspaceStream";
import { InlineStatusBanner, PageSection, SummaryRow, ToolbarRow } from "./ProductPrimitives";

// ── Step type metadata ────────────────────────────────────────────────────────

type BuilderStepType = "monitor" | "fetch_url" | "agent" | "conditional" | "artifact" | "approval" | "notification" | "context";

const BUILDER_STEP_TYPES: BuilderStepType[] = ["monitor", "fetch_url", "agent", "conditional", "artifact", "approval", "notification", "context"];

const STEP_TYPE_LABELS: Record<WorkflowStep["type"], string> = {
  monitor: "Monitor",
  fetch_url: "Fetch URL",
  agent: "Agent",
  conditional: "If / Then",
  artifact: "Artifact",
  approval: "Approval",
  notification: "Notify",
  context: "Context",
  tool: "Tool",
  action: "Action",
  "integration.read": "Read Data",
  "integration.action": "CRM Action",
};

function StepIcon({ type, className }: { type: WorkflowStep["type"]; className?: string }) {
  const props = { className: className ?? "size-4" };
  switch (type) {
    case "monitor": return <Radar {...props} />;
    case "fetch_url": return <Globe {...props} />;
    case "agent": return <Bot {...props} />;
    case "conditional": return <GitFork {...props} />;
    case "artifact": return <FileOutput {...props} />;
    case "approval": return <CheckSquare {...props} />;
    case "notification": return <BellRing {...props} />;
    case "context": return <Layers {...props} />;
    default: return <GitBranch {...props} />;
  }
}

function defaultStepConfig(type: WorkflowStep["type"]): Record<string, unknown> {
  switch (type) {
    case "monitor": return { targetType: "url", target: "", objective: "" };
    case "fetch_url": return { url: "", objective: "" };
    case "agent": return { agentId: "auto", task: "" };
    case "conditional": return { condition: "output_not_empty", onFalse: "stop" };
    case "artifact": return { artifactType: "document" };
    case "approval": return { policy: "external_only" };
    case "notification": return { channel: "in_app" };
    case "context": return { sources: ["memory", "artifacts"] };
    default: return {};
  }
}

function makeStep(type: BuilderStepType, order: number): WorkflowStep {
  return {
    id: crypto.randomUUID(),
    type,
    name: STEP_TYPE_LABELS[type],
    config: defaultStepConfig(type),
    order,
  };
}

// ── Step config fields (list view) ────────────────────────────────────────────

function StepConfigFields({
  step,
  agentOptions,
  onConfigChange,
}: {
  step: WorkflowStep;
  agentOptions: Array<{ id: string; name: string }>;
  onConfigChange: (field: string, value: unknown) => void;
}) {
  const inputClass =
    "mt-1 w-full rounded-xl border border-input bg-white px-3 py-1.5 text-sm outline-none ring-primary/20 focus:ring-4";

  switch (step.type) {
    case "monitor":
      return (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Monitor type</label>
            <select className={inputClass} value={String(step.config.targetType ?? "url")} onChange={(e) => onConfigChange("targetType", e.target.value)}>
              <option value="url">URL (web page)</option>
              <option value="keyword">Keyword / topic</option>
              <option value="company">Company</option>
              <option value="person">Person</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              {String(step.config.targetType ?? "url") === "url" ? "URL" : "Target"}
            </label>
            <input
              className={inputClass}
              placeholder={String(step.config.targetType ?? "url") === "url" ? "https://example.com" : "e.g. OpenAI, Elon Musk"}
              value={String(step.config.target ?? "")}
              onChange={(e) => onConfigChange("target", e.target.value)}
            />
            {String(step.config.targetType ?? "url") === "url" && !String(step.config.target ?? "").startsWith("http") && String(step.config.target ?? "").length > 0 && (
              <p className="mt-0.5 text-[11px] text-[hsl(var(--badge-warning-text))]">Include https:// — e.g. https://example.com</p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground">Objective</label>
            <input className={inputClass} placeholder="What to watch for (optional)" value={String(step.config.objective ?? "")} onChange={(e) => onConfigChange("objective", e.target.value)} />
          </div>
        </div>
      );
    case "agent":
      return (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Agent</label>
            <select className={inputClass} value={String(step.config.agentId ?? "auto")} onChange={(e) => onConfigChange("agentId", e.target.value)}>
              <option value="auto">Auto (Let Gideon decide)</option>
              {agentOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground">Task</label>
            <textarea rows={3} className={`${inputClass} resize-none`} placeholder="Describe what the agent should do. Output from the previous step is automatically available as context." value={String(step.config.task ?? "")} onChange={(e) => onConfigChange("task", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <p className="rounded-lg bg-primary/5 px-2 py-1.5 text-[11px] text-primary/80">
              ✦ Previous step output is automatically passed as context — you don&apos;t need to reference it explicitly.
              Use <code className="rounded bg-muted px-1">{"{{variable}}"}</code> for manual run-time inputs.
            </p>
          </div>
        </div>
      );
    case "artifact":
      return (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Title (optional)</label>
            <input className={inputClass} placeholder="Auto-generated if blank" value={String(step.config.title ?? "")} onChange={(e) => onConfigChange("title", e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Artifact type</label>
            <select className={inputClass} value={String(step.config.artifactType ?? "document")} onChange={(e) => onConfigChange("artifactType", e.target.value)}>
              <option value="summary">Summary</option>
              <option value="report">Report</option>
              <option value="document">Document</option>
              <option value="draft">Draft</option>
              <option value="data">Data / Insight</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground">Content source</label>
            <select className={inputClass} value={String(step.config.contentSource ?? "previous_step")} onChange={(e) => onConfigChange("contentSource", e.target.value)}>
              <option value="previous_step">Previous step output</option>
              <option value="run_summary">All steps combined</option>
            </select>
          </div>
        </div>
      );
    case "approval":
      return (
        <div className="mt-3">
          <label className="text-xs font-medium text-muted-foreground">Approval policy</label>
          <select className={inputClass} value={String(step.config.policy ?? "external_only")} onChange={(e) => onConfigChange("policy", e.target.value)}>
            <option value="external_only">External actions only</option>
            <option value="any_member">Any write action</option>
          </select>
        </div>
      );
    case "notification":
      return (
        <div className="mt-3">
          <label className="text-xs font-medium text-muted-foreground">Channel</label>
          <select className={inputClass} value={String(step.config.channel ?? "in_app")} onChange={(e) => onConfigChange("channel", e.target.value)}>
            <option value="in_app">In-app notification</option>
            <option value="email">Email (falls back to in-app)</option>
          </select>
        </div>
      );
    case "context":
      return <p className="mt-2 text-xs text-muted-foreground">Gathers workspace memory and recent artifacts for the next agent step.</p>;
    default:
      return null;
  }
}

// ── Trigger configurator ──────────────────────────────────────────────────────

function normalizeTriggerType(type: string): "manual" | "scheduled" | "integration_event" {
  if (type === "schedule" || type === "scheduled") return "scheduled";
  if (type === "integration_event") return "integration_event";
  return "manual";
}

function parseTrigger(trigger: Record<string, unknown>) {
  const type = normalizeTriggerType((trigger.type as string) ?? "manual");
  const cfg = (trigger.config as Record<string, string>) ?? {};
  return {
    type,
    cron: cfg.cron ?? (trigger.cron as string) ?? "0 9 * * *",
    timezone: cfg.timezone ?? (trigger.timezone as string) ?? "UTC",
    provider: cfg.provider ?? (trigger.provider as string) ?? "",
    eventType: cfg.eventType ?? (trigger.eventType as string) ?? "",
  };
}

function buildApiTrigger(type: string, cron: string, timezone: string, provider: string, eventType: string): Record<string, unknown> {
  if (type === "scheduled") return { type: "scheduled", config: { cron: cron || "0 9 * * *", timezone: timezone || "UTC" } };
  if (type === "integration_event") return { type: "integration_event", config: { provider, eventType } };
  return { type: "manual", config: {} };
}

function TriggerConfigurator({ trigger, onChange, readOnly, nextRunAt }: { trigger: Record<string, unknown>; onChange: (t: Record<string, unknown>) => void; readOnly: boolean; nextRunAt?: string | null }) {
  const parsed = parseTrigger(trigger);
  
  function emit(newType: string, ov: Partial<Record<string, string>> = {}) {
    const cron = ov.cron ?? parsed.cron ?? "0 9 * * *";
    const tz   = ov.timezone ?? parsed.timezone ?? "UTC";
    const prov = ov.provider ?? parsed.provider ?? "";
    const evt  = ov.eventType ?? parsed.eventType ?? "";
    
    if (newType === "scheduled")        onChange(buildApiTrigger("scheduled", cron, tz, prov, evt));
    else if (newType === "integration_event") onChange(buildApiTrigger("integration_event", cron, tz, prov, evt));
    else onChange(buildApiTrigger("manual", cron, tz, prov, evt));
  }

  const inputClass = "mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none ring-primary/20 focus:ring-4";

  return (
    <div className="rounded-container border border-border bg-background p-4">
      <div className="flex items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Zap className="size-3.5" />
        </div>
        <p className="text-sm font-semibold">Trigger Configuration</p>
        {!readOnly && (
          <div className="ml-auto flex gap-1 bg-muted/50 p-1 rounded-xl">
            {(["manual", "scheduled", "integration_event"] as const).map((t) => (
              <button key={t} type="button" onClick={() => emit(t)} disabled={t === "integration_event"}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition ${parsed.type === t ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"} ${t === "integration_event" ? "cursor-not-allowed opacity-50" : ""}`}>
                {t === "manual" ? "Manual" : t === "scheduled" ? "Scheduled" : "Event (soon)"}
              </button>
            ))}
          </div>
        )}
      </div>

      {!readOnly ? (
        <>
          {parsed.type === "scheduled" && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Frequency</label>
                <select className={inputClass} 
                  value={(() => {
                    const c = parsed.cron;
                    if (c === "0 * * * *") return "hourly";
                    if (c.startsWith("*/") && c.endsWith("* * * *")) return "minutes";
                    const p = c.split(" ");
                    if (p.length === 5 && !c.includes("*/")) {
                      if (p[2] === "*" && p[3] === "*" && p[4] === "*") return "daily";
                      if (p[2] === "*" && p[3] === "*" && p[4] !== "*") return "weekly";
                      if (p[2] !== "*" && p[3] === "*" && p[4] === "*") return "monthly";
                    }
                    return "custom";
                  })()}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "minutes") emit("scheduled", { cron: "*/15 * * * *" });
                    else if (val === "hourly") emit("scheduled", { cron: "0 * * * *" });
                    else if (val === "daily") emit("scheduled", { cron: "0 9 * * *" });
                    else if (val === "weekly") emit("scheduled", { cron: "0 9 * * 1" });
                    else if (val === "monthly") emit("scheduled", { cron: "0 9 1 * *" });
                    else emit("scheduled", { cron: "* * * * *" });
                  }}>
                  <option value="minutes">Minutes</option>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="custom">Custom (Cron)</option>
                </select>
              </div>

              {(() => {
                const c = parsed.cron;
                let freq = "custom";
                let time = "09:00";
                let day = "1";
                let date = "1";
                let mins = "15";

                if (c === "0 * * * *") freq = "hourly";
                else if (c.startsWith("*/") && c.endsWith("* * * *")) {
                  freq = "minutes";
                  mins = c.split(" ")[0].replace("*/", "");
                }
                else {
                  const p = c.split(" ");
                  if (p.length === 5 && !c.includes("*/")) {
                    if (p[0] !== "*" && p[1] !== "*") {
                      time = `${p[1].padStart(2, '0')}:${p[0].padStart(2, '0')}`;
                    }
                    if (p[2] === "*" && p[3] === "*" && p[4] === "*") freq = "daily";
                    else if (p[2] === "*" && p[3] === "*" && p[4] !== "*") { freq = "weekly"; day = p[4]; }
                    else if (p[2] !== "*" && p[3] === "*" && p[4] === "*") { freq = "monthly"; date = p[2]; }
                  }
                }

                const update = (updates: any) => {
                  const nFreq = updates.freq ?? freq;
                  const nt = updates.time ?? time;
                  const nd = updates.day ?? day;
                  const ndate = updates.date ?? date;
                  const nmins = updates.mins ?? mins;

                  if (nFreq === "minutes") return emit("scheduled", { cron: `*/${nmins} * * * *` });
                  
                  const [h, m] = nt.split(":");
                  const hr = parseInt(h || "9", 10).toString();
                  const mn = parseInt(m || "0", 10).toString();
                  
                  if (nFreq === "daily") emit("scheduled", { cron: `${mn} ${hr} * * *` });
                  else if (nFreq === "weekly") emit("scheduled", { cron: `${mn} ${hr} * * ${nd}` });
                  else if (nFreq === "monthly") emit("scheduled", { cron: `${mn} ${hr} ${ndate} * *` });
                };

                return (
                  <>
                    {freq === "custom" && (
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Cron Expression</label>
                        <input className={inputClass} value={c} onChange={(e) => emit("scheduled", { cron: e.target.value })} />
                      </div>
                    )}

                    {freq === "minutes" && (
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Every (minutes)</label>
                        <select className={inputClass} value={mins} onChange={(e) => update({ freq: "minutes", mins: e.target.value })}>
                          <option value="5">5 minutes</option>
                          <option value="10">10 minutes</option>
                          <option value="15">15 minutes</option>
                          <option value="30">30 minutes</option>
                          <option value="45">45 minutes</option>
                        </select>
                      </div>
                    )}

                    {(freq === "daily" || freq === "weekly" || freq === "monthly") && (
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Time</label>
                        <input type="time" className={inputClass} value={time} onChange={(e) => update({ freq, time: e.target.value })} />
                      </div>
                    )}

                    {freq === "weekly" && (
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Day</label>
                        <select className={inputClass} value={day} onChange={(e) => update({ freq, day: e.target.value })}>
                          <option value="1">Monday</option>
                          <option value="2">Tuesday</option>
                          <option value="3">Wednesday</option>
                          <option value="4">Thursday</option>
                          <option value="5">Friday</option>
                          <option value="6">Saturday</option>
                          <option value="0">Sunday</option>
                          <option value="1-5">Weekdays</option>
                        </select>
                      </div>
                    )}

                    {freq === "monthly" && (
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Date</label>
                        <input type="number" min="1" max="31" className={inputClass} value={date} onChange={(e) => update({ freq, date: e.target.value })} />
                      </div>
                    )}
                  </>
                );
              })()}

              <div>
                <label className="text-xs font-medium text-muted-foreground">Timezone</label>
                <select className={inputClass} 
                  value={parsed.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"}
                  onChange={(e) => emit("scheduled", { timezone: e.target.value })}>
                  <option value="UTC">UTC / GMT</option>
                  <optgroup label="US & Canada">
                    <option value="America/New_York">Eastern Time (ET)</option>
                    <option value="America/Chicago">Central Time (CT)</option>
                    <option value="America/Denver">Mountain Time (MT)</option>
                    <option value="America/Los_Angeles">Pacific Time (PT)</option>
                  </optgroup>
                  <optgroup label="Europe">
                    <option value="Europe/London">London (GMT/BST)</option>
                    <option value="Europe/Paris">Central Europe (CET)</option>
                  </optgroup>
                  <optgroup label="Asia & Pacific">
                    <option value="Asia/Dubai">Dubai (GST)</option>
                    <option value="Asia/Kolkata">India (IST)</option>
                    <option value="Asia/Singapore">Singapore (SGT)</option>
                    <option value="Australia/Sydney">Sydney (AEST)</option>
                  </optgroup>
                  {parsed.timezone && ![
                    "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
                    "Europe/London", "Europe/Paris", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney"
                  ].includes(parsed.timezone) && (
                    <option value={parsed.timezone}>{parsed.timezone}</option>
                  )}
                  {!parsed.timezone && Intl.DateTimeFormat().resolvedOptions().timeZone && ![
                    "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
                    "Europe/London", "Europe/Paris", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney"
                  ].includes(Intl.DateTimeFormat().resolvedOptions().timeZone) && (
                    <option value={Intl.DateTimeFormat().resolvedOptions().timeZone}>
                      {Intl.DateTimeFormat().resolvedOptions().timeZone} (Local)
                    </option>
                  )}
                </select>
              </div>
              
              <div className="sm:col-span-2 lg:col-span-3">
                {nextRunAt ? (
                  <p className="rounded-xl border border-[hsl(var(--badge-success-border))] bg-[hsl(var(--badge-success-bg))] px-3 py-2 text-xs font-medium text-[hsl(var(--badge-success-text))]">
                    Next run: {new Date(nextRunAt).toLocaleString()}
                  </p>
                ) : (
                  <p className="rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                    Save and activate the workflow to enable scheduled runs.
                  </p>
                )}
              </div>
            </div>
          )}
          {parsed.type === "integration_event" && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Provider</label>
                <select className={inputClass} value={parsed.provider} onChange={(e) => emit("integration_event", { provider: e.target.value })}>
                  <option value="">Select…</option>
                  <option value="google">Google (Calendar / Gmail)</option>
                  <option value="slack">Slack</option>
                  <option value="linear">Linear</option>
                  <option value="notion">Notion</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Event type</label>
                <input className={inputClass} placeholder="e.g. calendar.event_created" value={parsed.eventType} onChange={(e) => emit("integration_event", { eventType: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <p className="rounded-xl border border-[hsl(var(--badge-warning-border))] bg-[hsl(var(--badge-warning-bg))] px-3 py-2 text-xs font-medium text-[hsl(var(--badge-warning-text))]">Integration event triggers not yet live — run manually for now.</p>
              </div>
            </div>
          )}
          {parsed.type === "manual" && (
            <p className="mt-4 rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">Run manually from the Runs tab or via the API. No additional configuration needed.</p>
          )}
        </>
      ) : (
        <div className="mt-4 rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
          {parsed.type === "scheduled" ? `Scheduled — ${parsed.cron} (${parsed.timezone})` : parsed.type === "integration_event" ? `Event — ${parsed.provider}: ${parsed.eventType}` : "Manual execution"}
        </div>
      )}
    </div>
  );
}

// ── Run detail drawer ─────────────────────────────────────────────────────────

function friendlyError(message: string | null | undefined): string | null {
  if (!message) return null;
  const t = message.trim();
  // Raw Zod / JSON validation error — don't expose internals to the user
  if ((t.startsWith("[") || t.startsWith("{")) && t.includes('"code"')) {
    return "A data validation error occurred. Try running the workflow again, or check backend logs for details.";
  }
  return message;
}

function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatTs(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function RunDetailDrawer({
  run,
  open,
  onClose,
  onRerun,
}: {
  run: WorkflowRunDetail | null;
  open: boolean;
  onClose: () => void;
  onRerun?: () => void;
}) {
  if (!run) return null;

  const durationMs = run.completedAt && run.startedAt
    ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
    : null;

  return (
    <RightDetailDrawer
      open={open}
      onClose={onClose}
      title="Run details"
      description={`Started ${formatTs(run.startedAt)}`}
    >
      <div className="space-y-5">
        {/* Summary */}
        <div className="flex flex-wrap gap-4 rounded-xl border border-border bg-muted/30 p-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <div className="mt-1"><StatusPill status={run.status} /></div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Duration</p>
            <p className="mt-1 font-medium">{formatDuration(durationMs)}</p>
          </div>
          {run.completedAt && (
            <div>
              <p className="text-xs text-muted-foreground">Completed</p>
              <p className="mt-1 font-medium">{formatTs(run.completedAt)}</p>
            </div>
          )}
        </div>

        {/* Output summary */}
        {run.outputSummary && (
          <div>
            <p className="mb-2 text-sm font-medium">Output</p>
            <p className="rounded-xl border border-border bg-background p-3 text-sm leading-6 text-muted-foreground">
              {run.outputSummary}
            </p>
          </div>
        )}

        {/* Error */}
        {run.error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-xs font-medium text-destructive">Error</p>
            <p className="mt-1 text-xs text-destructive/80">{friendlyError(run.error)}</p>
          </div>
        )}

        {/* Step results */}
        {run.stepResults.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">Steps</p>
            <div className="space-y-2">
              {run.stepResults.map((step) => (
                <div key={step.stepId} className="rounded-xl border border-border bg-background px-3 py-2.5">
                  <div className="flex items-center gap-2 text-xs">
                    {step.status === "running" ? (
                      <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
                    ) : step.status === "completed" ? (
                      <span className="size-2.5 shrink-0 rounded-full bg-green-500" />
                    ) : step.status === "failed" ? (
                      <span className="size-2.5 shrink-0 rounded-full bg-destructive" />
                    ) : step.status === "waiting_approval" ? (
                      <span className="size-2.5 shrink-0 rounded-full bg-[hsl(var(--badge-warning-border))]" />
                    ) : step.status === "skipped" ? (
                      <span className="size-2.5 shrink-0 rounded-full bg-muted-foreground/30" />
                    ) : (
                      <span className="size-2.5 shrink-0 rounded-full border border-border" />
                    )}
                    <span className="font-medium text-foreground">{step.name}</span>
                    {step.approvalId && (
                      <Link href="/approvals" className="ml-auto shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline">
                        View approval →
                      </Link>
                    )}
                  </div>
                  {step.outputSummary && (
                    <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{(friendlyError(step.outputSummary) ?? step.outputSummary).slice(0, 400)}</p>
                  )}
                  {step.error && (
                    <p className="mt-1 text-xs text-destructive">{friendlyError(step.error)}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Artifacts */}
        {run.artifactIds.length > 0 && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {run.artifactIds.length} artifact{run.artifactIds.length !== 1 ? "s" : ""} created
              </p>
              <Button asChild size="sm" variant="outline">
                <Link href="/library">
                  View in Library
                  <ExternalLink className="ml-1.5 size-3" />
                </Link>
              </Button>
            </div>
          </div>
        )}

        {/* Approval waiting */}
        {run.status === "waiting_approval" && (
          <div className="rounded-xl border border-[hsl(var(--badge-warning-border))] bg-[hsl(var(--badge-warning-bg))] p-3">
            <p className="text-sm font-medium text-[hsl(var(--badge-warning-text))]">Waiting for approval</p>
            <p className="mt-0.5 text-xs text-[hsl(var(--badge-warning-text))]/80">This run is paused until an approval is reviewed.</p>
            <Button asChild size="sm" variant="outline" className="mt-2">
              <Link href="/approvals">Go to Approvals <ExternalLink className="ml-1.5 size-3" /></Link>
            </Button>
          </div>
        )}

        {/* Re-run */}
        {onRerun && ["completed", "failed", "cancelled"].includes(run.status) && (
          <div className="border-t border-border pt-4">
            <Button size="sm" variant="outline" onClick={onRerun} className="w-full">
              <Play className="mr-2 size-3.5" />
              Run again
            </Button>
          </div>
        )}
      </div>
    </RightDetailDrawer>
  );
}

// ── Fallback data ─────────────────────────────────────────────────────────────

const fallbackWorkflows: WorkflowListItem[] = [
  { id: "template_morning_command_brief", name: "Morning command brief", type: "template", status: "draft", triggerType: "manual", nextRunAt: null },
];

// ── Library view ──────────────────────────────────────────────────────────────

function WorkflowCard({
  workflow,
  onSelect,
  onClone,
}: {
  workflow: WorkflowListItem;
  onSelect: (id: string) => void;
  onClone?: (wf: WorkflowListItem) => void;
}) {
  const isTemplate = workflow.type === "template";
  const isActive = workflow.status === "active";

  return (
    <div
      className={cn(
        "group flex flex-col gap-3 rounded-container border bg-white p-5 transition hover:shadow-card",
        isActive ? "border-primary/20 ring-1 ring-primary/10" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-2xl shadow-sm ring-1 ring-border",
          isActive ? "bg-primary/5 text-primary" : "bg-muted/50 text-muted-foreground",
        )}>
          <GitBranch className="size-4" />
        </div>
        <StatusPill status={workflow.status} />
      </div>

      <div>
        <h3 className="font-semibold leading-snug">{workflow.name}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Zap className="size-3" />
            {workflow.triggerType}
          </span>
          <span className="rounded-full border border-border bg-secondary/50 px-1.5 py-px text-[10px] uppercase tracking-wide">
            {workflow.type}
          </span>
        </div>
      </div>

      <div className="mt-auto flex gap-2 pt-1">
        {isTemplate ? (
          <Button
            size="sm"
            className="flex-1 text-xs"
            onClick={() => onClone?.(workflow)}
          >
            <Copy className="mr-1.5 size-3.5" />
            Use template
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs"
            onClick={() => onSelect(workflow.id)}
          >
            Open
            <ChevronRight className="ml-1 size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Runs tab ──────────────────────────────────────────────────────────────────

function RunsTab({
  workflowId,
  activeRunId,
  activeRunDetail,
  running,
  cancelling,
  placeholderKeys,
  placeholderValues,
  showPlaceholderForm,
  loadingPlaceholders,
  onRun,
  onCancelRun,
  onSetPlaceholderValue,
  onSubmitPlaceholders,
  onCancelPlaceholderForm,
  onSelectRunForDetail,
}: {
  workflowId: string;
  activeRunId: string | null;
  activeRunDetail: WorkflowRunDetail | null;
  running: boolean;
  cancelling: boolean;
  placeholderKeys: string[];
  placeholderValues: Record<string, string>;
  showPlaceholderForm: boolean;
  loadingPlaceholders: boolean;
  onRun: () => void;
  onCancelRun: () => void;
  onSetPlaceholderValue: (key: string, value: string) => void;
  onSubmitPlaceholders: () => void;
  onCancelPlaceholderForm: () => void;
  onSelectRunForDetail: (runId: string) => void;
}) {
  const runsQuery = useWorkflowRunsQuery(workflowId, { enabled: true });
  const runs = runsQuery.data?.runs ?? [];
  const hasActiveRun = activeRunId !== null;
  const isTerminal = activeRunDetail
    ? ["completed", "failed", "cancelled", "waiting_approval"].includes(activeRunDetail.status)
    : false;
  const canCancel = hasActiveRun && !isTerminal;

  return (
    <div className="space-y-6">
      {/* Run launcher */}
      <div className="rounded-container border border-border bg-background p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Run this workflow</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Executes all steps in sequence. Results appear below.
            </p>
          </div>
          <div className="flex gap-2">
            {canCancel && (
              <Button size="sm" variant="outline" onClick={onCancelRun} disabled={cancelling}>
                {cancelling ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <X className="mr-1.5 size-3.5" />}
                {cancelling ? "Cancelling…" : "Cancel run"}
              </Button>
            )}
            <Button size="sm" onClick={onRun} disabled={running || loadingPlaceholders || hasActiveRun && !isTerminal}>
              {running || loadingPlaceholders ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Play className="mr-2 size-4" />
              )}
              Run
            </Button>
          </div>
        </div>

        {/* Placeholder form */}
        {showPlaceholderForm && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-xs font-medium text-muted-foreground">This workflow requires inputs before running</p>
            <div className="mt-3 space-y-3">
              {placeholderKeys.map((key) => (
                <div key={key}>
                  <label className="text-xs font-medium text-muted-foreground capitalize">{key.replace(/_/g, " ")}</label>
                  <Input
                    className="mt-1 h-9"
                    placeholder={`Enter ${key}`}
                    value={placeholderValues[key] ?? ""}
                    onChange={(e) => onSetPlaceholderValue(key, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={onSubmitPlaceholders} disabled={running}>
                {running ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Play className="mr-1.5 size-3.5" />}
                Run now
              </Button>
              <Button size="sm" variant="outline" onClick={onCancelPlaceholderForm}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Active run progress */}
        {activeRunDetail && (
          <div className="mt-4 border-t border-border pt-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold">Current run</p>
              <StatusPill status={activeRunDetail.status} />
            </div>
            {activeRunDetail.error && (
              <p className="mb-2 text-xs text-destructive">{activeRunDetail.error}</p>
            )}
            <div className="space-y-1.5">
              {activeRunDetail.stepResults.map((step) => (
                <div key={step.stepId} className="flex items-center gap-2 rounded-xl border border-border bg-background/50 px-3 py-2 text-xs">
                  {step.status === "running" ? (
                    <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
                  ) : step.status === "completed" ? (
                    <CheckCircle2 className="size-3 shrink-0 text-green-500" />
                  ) : step.status === "failed" ? (
                    <span className="size-2.5 shrink-0 rounded-full bg-destructive" />
                  ) : step.status === "waiting_approval" ? (
                    <span className="size-2.5 shrink-0 rounded-full bg-[hsl(var(--badge-warning-border))]" />
                  ) : (
                    <span className="size-2.5 shrink-0 rounded-full border border-border" />
                  )}
                  <span className="font-medium">{step.name}</span>
                  {step.outputSummary && (
                    <span className="ml-auto max-w-[180px] truncate text-muted-foreground/70">{step.outputSummary}</span>
                  )}
                  {step.approvalId && (
                    <Link href="/approvals" className="ml-auto shrink-0 font-medium text-primary underline-offset-2 hover:underline">
                      Review →
                    </Link>
                  )}
                </div>
              ))}
            </div>
            {activeRunDetail.artifactIds.length > 0 && (
              <div className="mt-3 flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                <span className="font-medium">{activeRunDetail.artifactIds.length} artifact{activeRunDetail.artifactIds.length !== 1 ? "s" : ""} created</span>
                <Button asChild size="sm" variant="outline" className="h-6 px-2 text-xs">
                  <Link href="/library">View <ExternalLink className="ml-1 size-3" /></Link>
                </Button>
              </div>
            )}
            {activeRunDetail.status === "waiting_approval" && (
              <div className="mt-3 rounded-xl border border-[hsl(var(--badge-warning-border))] bg-[hsl(var(--badge-warning-bg))] px-3 py-2 text-xs text-[hsl(var(--badge-warning-text))]">
                Paused — <Link href="/approvals" className="font-medium underline-offset-2 hover:underline">review the approval</Link> to continue.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Run history */}
      <div>
        <p className="mb-3 text-sm font-semibold">Run history</p>
        {runsQuery.isLoading ? (
          <LoadingState label="Loading runs…" rows={3} />
        ) : runs.length === 0 ? (
          <div className="rounded-card border border-dashed border-border py-10 text-center">
            <Timer className="mx-auto size-6 text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">No runs yet</p>
            <p className="mt-0.5 text-xs text-muted-foreground/70">Click Run above to execute this workflow</p>
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map((run: WorkflowRunListItem) => (
              <button
                key={run.runId}
                type="button"
                onClick={() => onSelectRunForDetail(run.runId)}
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-left transition hover:border-primary/20 hover:bg-primary/5"
              >
                <div className="flex items-center gap-3">
                  <StatusPill status={run.status} />
                  <span className="text-xs text-muted-foreground">
                    {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}
                  </span>
                  <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground/70">
                    <Timer className="size-3" />
                    {formatDuration(run.durationMs)}
                  </span>
                  <ChevronRight className="size-3.5 text-muted-foreground/40" />
                </div>
                {run.outputSummary && (
                  <p className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">{run.outputSummary}</p>
                )}
                {run.error && (
                  <p className="mt-1 text-xs text-destructive">{friendlyError(run.error)}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Builder view ──────────────────────────────────────────────────────────────

type BuilderViewProps = {
  workflowId: string;
  agentOptions: Array<{ id: string; name: string }>;
  onBack: () => void;
};

function BuilderView({ workflowId, agentOptions, onBack }: BuilderViewProps) {
  const { idToken } = useAuth();
  const queryClient = useQueryClient();

  const workflowQuery = useWorkflowDetailQuery(workflowId);
  const workflow = workflowQuery.data ?? null;
  const isTemplate = workflow?.type === "template";

  // Builder state
  const [editingName, setEditingName] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [editingSteps, setEditingSteps] = useState<WorkflowStep[]>([]);
  const [editingTrigger, setEditingTrigger] = useState<Record<string, unknown>>({ type: "manual", config: {} });
  const [isDirty, setIsDirty] = useState(false);
  const initializedForRef = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [builderMode, setBuilderMode] = useState<"canvas" | "list">("canvas");
  const [addingStep, setAddingStep] = useState(false);

  // Tabs
  const [tab, setTab] = useState<"build" | "runs">("build");

  // Status change
  const [statusChanging, setStatusChanging] = useState(false);

  // Delete
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Clone
  const [cloning, setCloning] = useState(false);

  // Run state
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<WorkflowRunDetail | null>(null);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const pollingRef = useRef(false);

  // Run detail drawer
  const [drawerRunDetail, setDrawerRunDetail] = useState<WorkflowRunDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Placeholder form
  const [placeholderKeys, setPlaceholderKeys] = useState<string[]>([]);
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  const [showPlaceholderForm, setShowPlaceholderForm] = useState(false);
  const [loadingPlaceholders, setLoadingPlaceholders] = useState(false);

  // Error
  const [actionError, setActionError] = useState<string | null>(null);

  // Sync editable state when workflow data arrives.
  // Guard: skip if data is for a different workflowId (stale query), or if already
  // initialized for this id (prevents clobbering unsaved edits on refetch).
  useEffect(() => {
    if (!workflow || workflow.type !== "custom") return;
    if (workflow.id !== workflowId) return;
    if (initializedForRef.current === workflowId) return;
    initializedForRef.current = workflowId;
    setEditingName(workflow.name);
    setEditingDescription(workflow.description ?? "");
    setEditingSteps(workflow.steps);
    setEditingTrigger(workflow.trigger ?? { type: "manual", config: {} });
    setIsDirty(false);
    setConfirmDelete(false);
    setActionError(null);
  }, [workflow, workflowId]);

  // SSE-driven run updates — react immediately to step/run events
  useWorkspaceStream(
    ["workflow.run.completed", "workflow.run.failed", "workflow.step.started", "workflow.step.completed", "workflow.step.failed", "workflow.waiting_approval"],
    useCallback((event, data) => {
      const d = data as Record<string, unknown>;
      const eventRunId = String(d.runId ?? "");
      if (!activeRunId || eventRunId !== activeRunId || !idToken) return;
      void fetchWorkflowRun(idToken, workflowId, activeRunId).then((run) => {
        setRunDetail(run);
        if (["completed", "failed", "cancelled", "waiting_approval"].includes(run.status)) {
          pollingRef.current = true;
        }
      }).catch(() => undefined);
    }, [activeRunId, idToken, workflowId]),
  );

  // Fallback poll (10s) in case SSE misses an event
  useEffect(() => {
    if (!activeRunId || !idToken) return;
    pollingRef.current = false;

    async function poll() {
      if (pollingRef.current) return;
      try {
        const run = await fetchWorkflowRun(idToken!, workflowId, activeRunId!);
        setRunDetail(run);
        if (["completed", "failed", "cancelled", "waiting_approval"].includes(run.status)) return;
      } catch { /* ignore transient failures */ }
      if (!pollingRef.current) setTimeout(poll, 10_000);
    }

    void poll();
    return () => { pollingRef.current = true; };
  }, [activeRunId, idToken, workflowId]);

  function markDirty() { setIsDirty(true); }

  function updateStepName(id: string, name: string) { setEditingSteps((p) => p.map((s) => s.id === id ? { ...s, name } : s)); markDirty(); }
  function updateStepType(id: string, type: WorkflowStep["type"]) {
    setEditingSteps((p) => p.map((s) => {
      if (s.id !== id) return s;
      // Auto-rename if the name is still the default for the old type
      const isDefaultName = s.name === (STEP_TYPE_LABELS[s.type] ?? s.type);
      return { ...s, type, name: isDefaultName ? (STEP_TYPE_LABELS[type] ?? type) : s.name, config: defaultStepConfig(type) };
    }));
    markDirty();
  }
  function updateStepConfig(id: string, field: string, value: unknown) { setEditingSteps((p) => p.map((s) => s.id === id ? { ...s, config: { ...s.config, [field]: value } } : s)); markDirty(); }
  function moveStep(id: string, dir: "up" | "down") {
    const idx = editingSteps.findIndex((s) => s.id === id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= editingSteps.length) return;
    const next = [...editingSteps];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    setEditingSteps(next.map((s, i) => ({ ...s, order: i })));
    markDirty();
  }
  function removeStep(id: string) { setEditingSteps((p) => p.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i }))); markDirty(); }
  function addStep(type: BuilderStepType) { setEditingSteps((p) => [...p, makeStep(type, p.length)]); setAddingStep(false); markDirty(); }

  async function handleSave() {
    if (!idToken) return;
    setSaving(true); setActionError(null);
    try {
      await saveWorkflow({ firebaseIdToken: idToken, workflowId, name: editingName || "Untitled", description: editingDescription || undefined, steps: editingSteps, trigger: editingTrigger });
      setIsDirty(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: gideonQueryKeys.workflows(idToken) }),
        queryClient.invalidateQueries({ queryKey: gideonQueryKeys.workflow(idToken, workflowId) }),
      ]);
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err, "Could not save workflow."));
    } finally { setSaving(false); }
  }

  async function handleStatusChange(next: "active" | "paused") {
    if (!idToken) return;
    setStatusChanging(true); setActionError(null);
    try {
      await updateWorkflowStatus({ firebaseIdToken: idToken, workflowId, status: next });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: gideonQueryKeys.workflows(idToken) }),
        queryClient.invalidateQueries({ queryKey: gideonQueryKeys.workflow(idToken, workflowId) }),
      ]);
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err, "Could not update status."));
    } finally { setStatusChanging(false); }
  }

  async function handleDelete() {
    if (!idToken) return;
    setDeleting(true); setActionError(null);
    try {
      await deleteWorkflow({ firebaseIdToken: idToken, workflowId });
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.workflows(idToken) });
      onBack();
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err, "Could not delete workflow."));
      setConfirmDelete(false);
    } finally { setDeleting(false); }
  }

  async function handleClone() {
    if (!idToken || !workflow) return;
    setCloning(true); setActionError(null);
    try {
      await createWorkflow({ firebaseIdToken: idToken, name: `${workflow.name} (copy)`, description: workflow.description ?? undefined, steps: workflow.steps });
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.workflows(idToken) });
      onBack();
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err, "Could not clone template."));
    } finally { setCloning(false); }
  }

  async function handleRun() {
    if (!idToken) return;
    setActionError(null); setLoadingPlaceholders(true);
    try {
      const { placeholders } = await fetchWorkflowPlaceholders(idToken, workflowId);
      if (placeholders.length > 0) {
        setPlaceholderKeys(placeholders);
        setPlaceholderValues(Object.fromEntries(placeholders.map((k) => [k, ""])));
        setShowPlaceholderForm(true);
        return;
      }
    } catch { /* proceed without inputs */ }
    finally { setLoadingPlaceholders(false); }
    await doRun({});
  }

  async function doRun(inputs: Record<string, string>) {
    if (!idToken) return;
    setRunning(true); setRunDetail(null); setActionError(null);
    try {
      const result = await runWorkflow({ firebaseIdToken: idToken, workflowId, input: inputs });
      setActiveRunId(result.runId);
      setTab("runs");
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err, "Could not start run."));
    } finally { setRunning(false); }
  }

  function handleSubmitPlaceholders() {
    const missing = placeholderKeys.filter((k) => !placeholderValues[k]?.trim());
    if (missing.length > 0) { setActionError(`Please fill in: ${missing.join(", ")}`); return; }
    setShowPlaceholderForm(false); setActionError(null);
    void doRun(Object.fromEntries(Object.entries(placeholderValues).map(([k, v]) => [k, v.trim()])));
  }

  async function handleCancelRun() {
    if (!idToken || !activeRunId) return;
    setCancelling(true);
    try {
      await cancelWorkflowRun({ firebaseIdToken: idToken, workflowId, runId: activeRunId });
      const run = await fetchWorkflowRun(idToken, workflowId, activeRunId);
      setRunDetail(run);
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err, "Could not cancel run."));
    } finally { setCancelling(false); }
  }

  async function handleSelectRunForDetail(runId: string) {
    if (!idToken) return;
    try {
      const run = await fetchWorkflowRun(idToken, workflowId, runId);
      setDrawerRunDetail(run);
      setDrawerOpen(true);
    } catch { /* ignore */ }
  }

  if (workflowQuery.isLoading) return <LoadingState label="Loading workflow…" rows={4} />;
  if (!workflow) return null;

  const isActive = workflow.status === "active";
  const triggerDisplayType = normalizeTriggerType((editingTrigger.type as string) ?? "manual");

  return (
    <PageErrorBoundary fallbackLabel="The workflow builder encountered an error.">
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              All workflows
            </button>
            <div className="flex items-center gap-3">
              <StatusPill status={workflow.status} />
              {isTemplate ? (
                <h2 className="text-xl font-semibold">{workflow.name}</h2>
              ) : (
                <input
                  value={editingName}
                  onChange={(e) => { setEditingName(e.target.value); markDirty(); }}
                  className="flex-1 bg-transparent text-xl font-semibold outline-none border-b-2 border-transparent focus:border-primary/30"
                  placeholder="Workflow name"
                />
              )}
            </div>
            {!isTemplate && (
              <input
                value={editingDescription}
                onChange={(e) => { setEditingDescription(e.target.value); markDirty(); }}
                className="mt-1.5 w-full bg-transparent text-sm text-muted-foreground outline-none border-b border-transparent focus:border-primary/20"
                placeholder="Add a description…"
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isTemplate ? (
              <Button size="sm" onClick={handleClone} disabled={cloning}>
                {cloning ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Copy className="mr-2 size-4" />}
                {cloning ? "Cloning…" : "Use this template"}
              </Button>
            ) : isDirty ? (
              <>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => {
                  if (!workflow) return;
                  setEditingName(workflow.name);
                  setEditingDescription(workflow.description ?? "");
                  setEditingSteps(workflow.steps);
                  setEditingTrigger(workflow.trigger ?? { type: "manual", config: {} });
                  setIsDirty(false);
                }}>
                  Discard
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleStatusChange(isActive ? "paused" : "active")}
                  disabled={statusChanging}
                >
                  {statusChanging ? <Loader2 className="mr-2 size-4 animate-spin" /> : isActive ? <Pause className="mr-2 size-4" /> : <Play className="mr-2 size-4" />}
                  {isActive ? "Pause" : "Activate"}
                </Button>
                <Button size="sm" onClick={() => { setTab("runs"); void handleRun(); }} disabled={running || loadingPlaceholders}>
                  {running || loadingPlaceholders ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
                  Run
                </Button>
              </>
            )}
          </div>
        </div>

        {actionError && <ErrorState message={actionError} onRetry={() => setActionError(null)} />}

        {/* Tabs */}
        {!isTemplate && (
          <div className="flex border-b border-border">
            {(["build", "runs"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px",
                  tab === t
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "build" ? "Build" : "Runs"}
              </button>
            ))}
          </div>
        )}

        {/* Activated callout */}
        {!isTemplate && tab === "build" && isActive && !isDirty && (
          <div className="flex items-start gap-3 rounded-xl border border-[hsl(var(--badge-success-border))] bg-[hsl(var(--badge-success-bg))] px-4 py-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[hsl(var(--badge-success-text))]" />
            <div>
              <p className="text-sm font-medium text-[hsl(var(--badge-success-text))]">Workflow is active</p>
              <p className="mt-0.5 text-xs text-[hsl(var(--badge-success-text))]/80">
                {triggerDisplayType === "scheduled" && workflow.nextRunAt
                  ? <>Next scheduled run: <strong>{new Date(workflow.nextRunAt).toLocaleString()}</strong>. Results and history appear in the{" "}</>
                  : <>This workflow will run when triggered. Results and history appear in the{" "}</>
                }
                <button type="button" onClick={() => setTab("runs")} className="font-medium underline-offset-2 hover:underline">
                  Runs tab
                </button>.
              </p>
            </div>
          </div>
        )}

        {/* Build tab content */}
        {(isTemplate || tab === "build") && (
          <div className="space-y-5">
            {(isTemplate || builderMode === "list") && (
              <TriggerConfigurator
                trigger={isTemplate ? workflow.trigger : editingTrigger}
                onChange={(t) => { setEditingTrigger(t); markDirty(); }}
                readOnly={isTemplate}
                nextRunAt={isTemplate ? null : (workflow.nextRunAt ?? null)}
              />
            )}

            {/* Steps header + mode toggle */}
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {isTemplate ? "Steps" : `Steps (${editingSteps.length})`}
              </p>
              {!isTemplate && (
                <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5">
                  {(["canvas", "list"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setBuilderMode(m)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition",
                        builderMode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {m === "canvas" ? <Network className="size-3.5" /> : <LayoutList className="size-3.5" />}
                      {m === "canvas" ? "Canvas" : "List"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Canvas view */}
            {!isTemplate && builderMode === "canvas" && (
              <WorkflowCanvasView
                steps={editingSteps}
                trigger={editingTrigger}
                triggerType={triggerDisplayType}
                agentOptions={agentOptions}
                runDetail={runDetail}
                onAddStep={(type) => {
                  setEditingSteps((prev) => [...prev, {
                    id: crypto.randomUUID(),
                    type,
                    name: STEP_TYPE_LABELS[type] ?? type,
                    config: defaultStepConfig(type as BuilderStepType),
                    order: prev.length,
                  }]);
                  markDirty();
                }}
                onTriggerChange={(t) => { setEditingTrigger(t); markDirty(); }}
                onStepConfigChange={updateStepConfig}
                onStepNameChange={updateStepName}
                onStepTypeChange={updateStepType}
                onStepDelete={removeStep}
                onStepMove={moveStep}
                onStepsReorder={(orderedIds) => {
                  setEditingSteps((prev) => {
                    const map = new Map(prev.map((s) => [s.id, s]));
                    return orderedIds.flatMap((id, i) => {
                      const s = map.get(id);
                      return s ? [{ ...s, order: i }] : [];
                    });
                  });
                  markDirty();
                }}
              />
            )}

            {/* List view */}
            {(isTemplate || builderMode === "list") && (
              <div className="space-y-3">
                {(isTemplate ? workflow.steps : editingSteps).map((step, index) => (
                  <div key={step.id} className="rounded-container border border-border bg-background p-4">
                    <div className="flex items-center gap-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        {index + 1}
                      </span>
                      <StepIcon type={step.type} className="size-4 shrink-0 text-primary" />
                      {isTemplate ? (
                        <p className="flex-1 text-sm font-medium">{step.name}</p>
                      ) : (
                        <input
                          value={step.name}
                          onChange={(e) => updateStepName(step.id, e.target.value)}
                          className="flex-1 bg-transparent text-sm font-medium outline-none border-b border-transparent focus:border-primary/30"
                        />
                      )}
                      {!isTemplate && (
                        <div className="flex items-center gap-1 ml-auto">
                          <button type="button" onClick={() => moveStep(step.id, "up")} disabled={index === 0} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                          <button type="button" onClick={() => moveStep(step.id, "down")} disabled={index === editingSteps.length - 1} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                          <button type="button" onClick={() => removeStep(step.id)} className="rounded p-1 text-muted-foreground hover:text-destructive"><X className="size-3.5" /></button>
                        </div>
                      )}
                    </div>

                    {!isTemplate ? (
                      <>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {BUILDER_STEP_TYPES.map((t) => (
                            <button key={t} type="button" onClick={() => updateStepType(step.id, t)}
                              className={`rounded-full border px-2 py-0.5 text-xs transition ${step.type === t ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary/30"}`}>
                              {STEP_TYPE_LABELS[t]}
                            </button>
                          ))}
                        </div>
                        <StepConfigFields step={step} agentOptions={agentOptions} onConfigChange={(field, value) => updateStepConfig(step.id, field, value)} />
                      </>
                    ) : (
                      <p className="mt-1.5 pl-10 text-xs capitalize text-muted-foreground">{step.type}</p>
                    )}
                  </div>
                ))}

                {!isTemplate && (
                  addingStep ? (
                    <div className="rounded-container border border-dashed border-border p-4">
                      <p className="mb-3 text-xs font-medium text-muted-foreground">Choose step type</p>
                      <div className="flex flex-wrap gap-2">
                        {BUILDER_STEP_TYPES.map((t) => (
                          <button key={t} type="button" onClick={() => addStep(t)}
                            className="flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-1.5 text-sm hover:border-primary/30 hover:bg-primary/5">
                            <StepIcon type={t} className="size-3.5 text-primary" />
                            {STEP_TYPE_LABELS[t]}
                          </button>
                        ))}
                        <button type="button" onClick={() => setAddingStep(false)} className="rounded-xl border border-transparent px-3 py-1.5 text-sm text-muted-foreground hover:border-border">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setAddingStep(true)}
                      className="flex w-full items-center justify-center gap-2 rounded-container border border-dashed border-border py-3 text-sm text-muted-foreground hover:border-primary/30 hover:text-primary transition">
                      <Plus className="size-4" />
                      Add step
                    </button>
                  )
                )}
              </div>
            )}

            {/* Delete zone */}
            {!isTemplate && (
              <div className="border-t border-border pt-6">
                {confirmDelete ? (
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-muted-foreground">Delete this workflow permanently?</p>
                    <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleting}>
                      {deleting ? "Deleting…" : "Yes, delete"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-3.5" /> Delete workflow
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Runs tab content */}
        {!isTemplate && tab === "runs" && (
          <RunsTab
            workflowId={workflowId}
            activeRunId={activeRunId}
            activeRunDetail={runDetail}
            running={running}
            cancelling={cancelling}
            placeholderKeys={placeholderKeys}
            placeholderValues={placeholderValues}
            showPlaceholderForm={showPlaceholderForm}
            loadingPlaceholders={loadingPlaceholders}
            onRun={handleRun}
            onCancelRun={handleCancelRun}
            onSetPlaceholderValue={(key, val) => setPlaceholderValues((p) => ({ ...p, [key]: val }))}
            onSubmitPlaceholders={handleSubmitPlaceholders}
            onCancelPlaceholderForm={() => setShowPlaceholderForm(false)}
            onSelectRunForDetail={handleSelectRunForDetail}
          />
        )}
      </div>

      <RunDetailDrawer
        run={drawerRunDetail}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onRerun={() => { setDrawerOpen(false); void handleRun(); }}
      />
    </PageErrorBoundary>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function WorkflowsPage() {
  const queryClient = useQueryClient();
  const { idToken } = useAuth();
  const workflowsQuery = useWorkflowsQuery();
  const agentsQuery = useAgentsQuery();

  const [view, setView] = useState<"library" | "builder">("library");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [draftName, setDraftName] = useState("New workflow");
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cloning, setCloning] = useState<string | null>(null);

  const workflows = workflowsQuery.data?.workflows ?? [];
  const customWorkflows = workflows.filter((w) => w.type === "custom");
  const templateWorkflows = workflows.filter((w) => w.type === "template");
  const loading = workflowsQuery.isLoading && !workflowsQuery.data;

  const agentOptions = (agentsQuery.data?.agents ?? []).map((a) => ({ id: a.id, name: a.name }));
  if (agentOptions.length === 0) {
    agentOptions.push({ id: "executive", name: "Executive Assistant" }, { id: "research", name: "Research Assistant" });
  }

  function openBuilder(id: string) {
    setSelectedWorkflowId(id);
    setView("builder");
  }

  function goToLibrary() {
    setView("library");
    setSelectedWorkflowId(null);
  }

  async function handleCreate() {
    if (!idToken) return;
    setCreating(true); setActionError(null);
    try {
      const result = await createWorkflow({ firebaseIdToken: idToken, name: draftName.trim() || "Untitled workflow", description: "Custom workflow." });
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.workflows(idToken) });
      setShowCreateForm(false);
      setDraftName("New workflow");
      openBuilder(result.workflowId);
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err, "Could not create workflow."));
    } finally { setCreating(false); }
  }

  async function handleCloneTemplate(wf: WorkflowListItem) {
    if (!idToken) return;
    setCloning(wf.id); setActionError(null);
    try {
      const detail = await import("@/services/workflows").then((m) => m.fetchWorkflow(idToken, wf.id));
      const result = await createWorkflow({ firebaseIdToken: idToken, name: `${wf.name} (copy)`, description: (detail as { description?: string | null }).description ?? undefined, steps: (detail as { steps: WorkflowStep[] }).steps });
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.workflows(idToken) });
      openBuilder(result.workflowId);
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err, "Could not clone template."));
    } finally { setCloning(null); }
  }

  if (view === "builder" && selectedWorkflowId) {
    return (
      <section className="space-y-0">
        <BuilderView
          workflowId={selectedWorkflowId}
          agentOptions={agentOptions}
          onBack={goToLibrary}
        />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <ProductHeader
        eyebrow="Workflows"
        title="Workflows"
        description="Build repeatable automations with agents, approvals, and custom steps."
        meta={
          <SummaryRow
            className="md:grid-cols-2 xl:grid-cols-4"
            items={[
              {
                label: "Custom workflows",
                value: customWorkflows.length,
                detail: "Guided automations owned by this workspace.",
                icon: GitBranch,
                tone: customWorkflows.length > 0 ? "primary" : "neutral",
              },
              {
                label: "Active workflows",
                value: customWorkflows.filter((workflow) => workflow.status === "active").length,
                detail: "Flows currently live and able to run.",
                icon: Play,
                tone: customWorkflows.some((workflow) => workflow.status === "active") ? "success" : "neutral",
              },
              {
                label: "Templates",
                value: templateWorkflows.length > 0 ? templateWorkflows.length : fallbackWorkflows.filter((workflow) => workflow.type === "template").length,
                detail: "Starting points for recurring operational work.",
                icon: Layers,
                tone: "neutral",
              },
              {
                label: "Scheduled next",
                value: customWorkflows.filter((workflow) => Boolean(workflow.nextRunAt)).length,
                detail: "Workflows with an upcoming scheduled execution already in place.",
                icon: Timer,
                tone: customWorkflows.some((workflow) => workflow.nextRunAt) ? "warning" : "neutral",
              },
            ]}
          />
        }
        action={
          <Button size="sm" onClick={() => setShowCreateForm((v) => !v)}>
            <Plus className="mr-2 size-4" />
            New workflow
          </Button>
        }
      />

      {actionError ? (
        <InlineStatusBanner
          tone="error"
          title="Workflow action needs attention"
          description={actionError}
          action={
            <Button size="sm" variant="outline" onClick={() => setActionError(null)}>
              Dismiss
            </Button>
          }
        />
      ) : null}

      {/* Inline create form */}
      {showCreateForm && (
        <PageSection
          title="Create a workflow"
          description="Start with a named draft, then move into the builder to define steps, approvals, and execution details."
        >
            <div className="mt-3 flex gap-2">
              <Input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); if (e.key === "Escape") setShowCreateForm(false); }}
                placeholder="Workflow name"
                className="flex-1"
              />
              <Button size="sm" onClick={handleCreate} disabled={creating}>
                {creating ? <Loader2 className="size-4 animate-spin" /> : "Create"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowCreateForm(false)}>Cancel</Button>
            </div>
        </PageSection>
      )}

      {loading ? (
        <LoadingState label="Loading workflows…" rows={4} />
      ) : (
        <div className="space-y-8">
          {/* Custom workflows */}
          <PageSection
            title="My workflows"
            description="Operational automations owned by this workspace. Use the builder for structure, approvals, and repeated execution."
          >
            <ToolbarRow className="mb-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Workflow library</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Keep active workflows tight and intentional.
                </p>
              </div>
              {customWorkflows.length > 0 && (
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  {customWorkflows.filter((w) => w.status === "active").length} active
                </span>
              )}
            </ToolbarRow>
            {customWorkflows.length === 0 ? (
              <div className="rounded-container border border-dashed border-border py-12 text-center">
                <GitBranch className="mx-auto size-8 text-muted-foreground/30" />
                <p className="mt-3 text-sm font-medium">No workflows yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Create one above or start from a template below</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {customWorkflows.map((wf) => (
                  <WorkflowCard
                    key={wf.id}
                    workflow={wf}
                    onSelect={openBuilder}
                    onClone={handleCloneTemplate}
                  />
                ))}
              </div>
            )}
          </PageSection>

          {/* Templates */}
          {(templateWorkflows.length > 0 || fallbackWorkflows.some((f) => f.type === "template")) && (
            <PageSection
              title="Templates"
              description="Prebuilt workflow patterns for research, monitoring, reporting, and internal coordination."
            >
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {(templateWorkflows.length > 0 ? templateWorkflows : fallbackWorkflows).map((wf) => (
                  <WorkflowCard
                    key={wf.id}
                    workflow={wf}
                    onSelect={openBuilder}
                    onClone={(w) => {
                      setCloning(w.id);
                      void handleCloneTemplate(w).finally(() => setCloning(null));
                    }}
                  />
                ))}
              </div>
            </PageSection>
          )}
        </div>
      )}
    </section>
  );
}
