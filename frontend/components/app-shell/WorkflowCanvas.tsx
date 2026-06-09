"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type NodeProps,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowDown,
  ArrowUp,
  BellRing,
  Bot,
  CalendarPlus,
  CheckSquare,
  ClipboardList,
  Database,
  FileOutput,
  GitBranch,
  GitFork,
  Globe,
  Loader2,
  MailPlus,
  MessageSquare,
  Plus,
  Radar,
  Send,
  Settings2,
  Sheet,
  Trash2,
  UserCheck,
  UserPlus,
  Webhook,
  X,
  Zap,
} from "lucide-react";

import type { WorkflowRunDetail, WorkflowStep } from "@/services/workflows";

// ── Types ─────────────────────────────────────────────────────────────────────

export type WorkflowCanvasProps = {
  steps: WorkflowStep[];
  trigger: Record<string, unknown>;
  triggerType: string;
  agentOptions: Array<{ id: string; name: string }>;
  runDetail: WorkflowRunDetail | null;
  onAddStep: (type: WorkflowStep["type"]) => void;
  onTriggerChange: (trigger: Record<string, unknown>) => void;
  onStepConfigChange: (stepId: string, field: string, value: unknown) => void;
  onStepNameChange: (stepId: string, name: string) => void;
  onStepTypeChange: (stepId: string, type: WorkflowStep["type"]) => void;
  onStepDelete: (stepId: string) => void;
  onStepMove: (stepId: string, direction: "up" | "down") => void;
  onStepsReorder?: (orderedIds: string[]) => void;
  readonly?: boolean;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_W = 260;
const NODE_H = 68;
const V_GAP  = 56;
const CENTER_X = 0;

const STEP_TYPES: Array<{ type: WorkflowStep["type"]; label: string }> = [
  { type: "monitor",      label: "Monitor"     },
  { type: "fetch_url",    label: "Fetch URL"   },
  { type: "agent",        label: "Agent"       },
  { type: "conditional",  label: "If / Then"   },
  { type: "artifact",     label: "Artifact"    },
  { type: "context",      label: "Context"     },
  { type: "approval",     label: "Approval"    },
  { type: "notification", label: "Notify"      },
  { type: "integration.read",   label: "Read Data"   },
  { type: "integration.action", label: "CRM Action"  },
];

const COMING_SOON_STEPS: Array<{ label: string; icon: React.ReactNode }> = [
  { label: "Log Activity",  icon: <ClipboardList className="size-3.5" /> },
  { label: "Schedule Meet", icon: <CalendarPlus  className="size-3.5" /> },
  { label: "Slack Message", icon: <MessageSquare className="size-3.5" /> },
  { label: "Webhook",       icon: <Webhook       className="size-3.5" /> },
  { label: "Spreadsheet",   icon: <Sheet         className="size-3.5" /> },
];

const UNSUPPORTED_STEP_TYPES: Set<WorkflowStep["type"]> = new Set(["tool", "action"]);

const STEP_LABELS: Record<WorkflowStep["type"], string> = {
  monitor: "Monitor", fetch_url: "Fetch URL", agent: "Agent",
  conditional: "If / Then", artifact: "Artifact", context: "Context",
  approval: "Approval", notification: "Notify",
  tool: "Tool", action: "Action",
  "integration.read": "Read Data", "integration.action": "CRM Action",
};

// ── Icons ─────────────────────────────────────────────────────────────────────

function StepIcon({ type, className }: { type: WorkflowStep["type"]; className?: string }) {
  const cls = className ?? "size-4";
  switch (type) {
    case "monitor":      return <Radar       className={cls} />;
    case "fetch_url":    return <Globe       className={cls} />;
    case "agent":        return <Bot         className={cls} />;
    case "conditional":  return <GitFork     className={cls} />;
    case "artifact":     return <FileOutput  className={cls} />;
    case "approval":     return <CheckSquare className={cls} />;
    case "notification": return <BellRing    className={cls} />;
    case "context":      return <Database    className={cls} />;
    case "integration.read":   return <Database className={cls} />;
    case "integration.action": return <UserCheck className={cls} />;
    default:             return <GitBranch   className={cls} />;
  }
}

function statusDot(status?: string) {
  if (!status) return "bg-muted-foreground/20 border border-border";
  if (status === "completed")       return "bg-green-500";
  if (status === "failed")          return "bg-destructive";
  if (status === "waiting_approval") return "bg-[hsl(var(--badge-warning-border))]";
  if (status === "skipped")         return "bg-muted-foreground/30";
  return "bg-primary animate-pulse";
}

// ── Custom nodes ──────────────────────────────────────────────────────────────

function TriggerNode({ data }: NodeProps) {
  const d = data as { triggerType: string; isSelected: boolean };
  return (
    <div className={`flex w-[260px] cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3.5 shadow-sm transition-[border-color,box-shadow]
      ${d.isSelected
        ? "border-primary bg-primary/10 ring-2 ring-primary shadow-md"
        : "border-primary/30 bg-primary/5 hover:border-primary/60 hover:shadow-md"
      }`}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <Zap className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/70">Trigger</p>
        <p className="text-sm font-semibold capitalize truncate">{d.triggerType}</p>
      </div>
      {d.isSelected && <Settings2 className="size-3.5 text-primary/60 shrink-0" />}
      <Handle type="source" position={Position.Bottom} className="!size-2 !border-0 !bg-primary/50" />
    </div>
  );
}

function StepNode({ data }: NodeProps) {
  const d = data as {
    step: WorkflowStep;
    stepIndex: number;
    stepStatus?: string;
    isSelected: boolean;
  };
  return (
    <div className={`flex w-[260px] cursor-pointer items-center gap-3 rounded-2xl border bg-background px-4 py-3.5 shadow-sm transition-[border-color,box-shadow]
      ${d.isSelected
        ? "border-primary/60 ring-2 ring-primary shadow-md bg-primary/5"
        : "border-border hover:border-primary/30 hover:shadow-md"
      }`}
    >
      <Handle type="target" position={Position.Top}    className="!size-2 !border-0 !bg-muted-foreground/40" />
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
        {d.stepIndex + 1}
      </div>
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
        <StepIcon type={d.step.type} className="size-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-semibold">{d.step.name}</p>
        {UNSUPPORTED_STEP_TYPES.has(d.step.type) ? (
          <p className="text-[11px] font-medium text-[hsl(var(--badge-warning-text))]">Unsupported step type</p>
        ) : (
          <p className="text-[11px] capitalize text-muted-foreground">{STEP_LABELS[d.step.type]}</p>
        )}
      </div>
      {UNSUPPORTED_STEP_TYPES.has(d.step.type) ? (
        <span className="size-2.5 shrink-0 rounded-full bg-[hsl(var(--badge-warning-border))]" title="This step type is not yet supported and will be skipped during execution." />
      ) : d.stepStatus === "running" ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
      ) : (
        <span className={`size-2.5 shrink-0 rounded-full ${statusDot(d.stepStatus)}`} />
      )}
      <Handle type="source" position={Position.Bottom} className="!size-2 !border-0 !bg-muted-foreground/40" />
    </div>
  );
}

const NODE_TYPES = { trigger: TriggerNode, step: StepNode };

// ── Graph builder ─────────────────────────────────────────────────────────────

function buildNodes(
  steps: WorkflowStep[],
  selectedId: string | null,
  statusMap: Map<string, string>,
  existingPositions: Map<string, { x: number; y: number }>,
): Node[] {
  const triggerPos = existingPositions.get("__trigger__") ?? { x: CENTER_X, y: 0 };
  const nodes: Node[] = [
    {
      id: "__trigger__",
      type: "trigger",
      position: triggerPos,
      data: { triggerType: "manual", isSelected: selectedId === "__trigger__" },
      draggable: true,
      selectable: false,
      width: NODE_W,
    },
  ];
  steps.forEach((step, i) => {
    const defaultPos = { x: CENTER_X, y: (NODE_H + V_GAP) * (i + 1) + 20 };
    nodes.push({
      id: step.id,
      type: "step",
      position: existingPositions.get(step.id) ?? defaultPos,
      data: {
        step,
        stepIndex: i,
        stepStatus: statusMap.get(step.id),
        isSelected: selectedId === step.id,
      },
      draggable: true,
      selectable: false,
      width: NODE_W,
    });
  });
  return nodes;
}

function buildEdges(
  steps: WorkflowStep[],
  statusMap: Map<string, string>,
): Edge[] {
  const ids = ["__trigger__", ...steps.map((s) => s.id)];
  return ids.slice(0, -1).map((id, i) => {
    const prevStatus = i === 0 ? undefined : statusMap.get(ids[i]);
    return {
      id: `e-${id}-${ids[i + 1]}`,
      source: id,
      target: ids[i + 1],
      type: "smoothstep",
      style: {
        stroke: prevStatus === "completed" ? "#22c55e" : "hsl(var(--border))",
        strokeWidth: 2,
      },
      animated: statusMap.get(ids[i]) === "running",
    };
  });
}

// ── Config panel ──────────────────────────────────────────────────────────────

const inputCls =
  "mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none ring-primary/20 focus:ring-4";

function TriggerConfigPanel({
  trigger,
  onChange,
  onClose,
}: {
  trigger: Record<string, unknown>;
  onChange: (t: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  function getType() {
    const t = String(trigger.type ?? "manual");
    if (t === "schedule" || t === "scheduled") return "scheduled";
    if (t === "integration_event") return "integration_event";
    return "manual";
  }
  const getCfg = () => (trigger.config as Record<string, string>) ?? {};
  const type = getType();
  const cfg  = getCfg();

  function emit(newType: string, ov: Partial<Record<string, string>> = {}) {
    const cron = ov.cron ?? cfg.cron ?? "0 9 * * *";
    const tz   = ov.timezone ?? cfg.timezone ?? "UTC";
    const prov = ov.provider ?? cfg.provider ?? "";
    const evt  = ov.eventType ?? cfg.eventType ?? "";
    if (newType === "scheduled")        onChange({ type: "scheduled", config: { cron, timezone: tz } });
    else if (newType === "integration_event") onChange({ type: "integration_event", config: { provider: prov, eventType: evt } });
    else onChange({ type: "manual", config: {} });
  }

  return (
    <ConfigShell title="Trigger" icon={<Zap className="size-4" />} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Trigger type</p>
          <div className="grid grid-cols-3 gap-1">
            {(["manual", "scheduled", "integration_event"] as const).map((t) => (
              <button key={t} type="button" onClick={() => emit(t)}
                className={`rounded-xl border px-2 py-1.5 text-[11px] font-medium transition
                  ${type === t ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"}`}
              >
                {t === "manual" ? "Manual" : t === "scheduled" ? "Scheduled" : "Event"}
              </button>
            ))}
          </div>
        </div>
        {type === "scheduled" && (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Frequency</label>
              <select className={inputCls} 
                value={(() => {
                  const c = cfg.cron ?? "0 9 * * *";
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
                  else emit("scheduled", { cron: "* * * * *" }); // Triggers custom
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
              const c = cfg.cron ?? "0 9 * * *";
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
                      <input className={inputCls} value={c} onChange={(e) => emit("scheduled", { cron: e.target.value })} />
                    </div>
                  )}

                  {freq === "minutes" && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Every (minutes)</label>
                      <select className={inputCls} value={mins} onChange={(e) => update({ freq: "minutes", mins: e.target.value })}>
                        <option value="5">5 minutes</option>
                        <option value="10">10 minutes</option>
                        <option value="15">15 minutes</option>
                        <option value="30">30 minutes</option>
                        <option value="45">45 minutes</option>
                      </select>
                    </div>
                  )}

                  {(freq === "daily" || freq === "weekly" || freq === "monthly") && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Time</label>
                        <input type="time" className={inputCls} value={time} onChange={(e) => update({ freq, time: e.target.value })} />
                      </div>
                      
                      {freq === "weekly" && (
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Day</label>
                          <select className={inputCls} value={day} onChange={(e) => update({ freq, day: e.target.value })}>
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
                          <input type="number" min="1" max="31" className={inputCls} value={date} onChange={(e) => update({ freq, date: e.target.value })} />
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Timezone</label>
              <select className={inputCls} 
                defaultValue={cfg.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"}
                onChange={(e) => emit("scheduled", { timezone: e.target.value })}>
                <option value="UTC">UTC / GMT</option>
                <optgroup label="US & Canada">
                  <option value="America/New_York">Eastern Time (ET)</option>
                  <option value="America/Chicago">Central Time (CT)</option>
                  <option value="America/Denver">Mountain Time (MT)</option>
                  <option value="America/Los_Angeles">Pacific Time (PT)</option>
                  <option value="America/Anchorage">Alaska Time (AKT)</option>
                  <option value="Pacific/Honolulu">Hawaii Time (HT)</option>
                </optgroup>
                <optgroup label="Europe">
                  <option value="Europe/London">London (GMT/BST)</option>
                  <option value="Europe/Paris">Central Europe (CET)</option>
                  <option value="Europe/Athens">Eastern Europe (EET)</option>
                </optgroup>
                <optgroup label="Asia & Middle East">
                  <option value="Asia/Dubai">Dubai (GST)</option>
                  <option value="Asia/Kolkata">India (IST)</option>
                  <option value="Asia/Bangkok">Indochina (ICT)</option>
                  <option value="Asia/Singapore">Singapore (SGT)</option>
                  <option value="Asia/Tokyo">Tokyo (JST)</option>
                </optgroup>
                <optgroup label="Australia & Pacific">
                  <option value="Australia/Sydney">Sydney (AEST)</option>
                  <option value="Australia/Adelaide">Adelaide (ACST)</option>
                  <option value="Pacific/Auckland">Auckland (NZST)</option>
                </optgroup>
                
                {/* Fallback for custom timezones not in the list */}
                {cfg.timezone && ![
                  "UTC", "America/New_York", "America/Chicago", "America/Denver", 
                  "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
                  "Europe/London", "Europe/Paris", "Europe/Athens",
                  "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Singapore", "Asia/Tokyo",
                  "Australia/Sydney", "Australia/Adelaide", "Pacific/Auckland"
                ].includes(cfg.timezone) && (
                  <option value={cfg.timezone}>{cfg.timezone}</option>
                )}
                {/* Fallback for auto-detected local timezone if not in list */}
                {!cfg.timezone && Intl.DateTimeFormat().resolvedOptions().timeZone && ![
                  "UTC", "America/New_York", "America/Chicago", "America/Denver", 
                  "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
                  "Europe/London", "Europe/Paris", "Europe/Athens",
                  "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Singapore", "Asia/Tokyo",
                  "Australia/Sydney", "Australia/Adelaide", "Pacific/Auckland"
                ].includes(Intl.DateTimeFormat().resolvedOptions().timeZone) && (
                  <option value={Intl.DateTimeFormat().resolvedOptions().timeZone}>
                    {Intl.DateTimeFormat().resolvedOptions().timeZone} (Local)
                  </option>
                )}
              </select>
            </div>
          </>
        )}
        {type === "integration_event" && (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Provider</label>
              <select className={inputCls} defaultValue={cfg.provider ?? ""}
                onBlur={(e) => emit("integration_event", { provider: e.target.value })}>
                <option value="">Select…</option>
                <option value="google">Google (Calendar / Gmail)</option>
                <option value="slack">Slack</option>
                <option value="linear">Linear</option>
                <option value="notion">Notion</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Event type</label>
              <input className={inputCls} placeholder="e.g. calendar.event_created"
                defaultValue={cfg.eventType ?? ""}
                onBlur={(e) => emit("integration_event", { eventType: e.target.value })} />
            </div>
          </>
        )}
        {type === "manual" && (
          <p className="rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Run manually from the Runs tab. No additional configuration needed.
          </p>
        )}
      </div>
    </ConfigShell>
  );
}

function StepConfigPanel({
  step,
  stepIndex,
  totalSteps,
  agentOptions,
  onConfigChange,
  onNameChange,
  onTypeChange,
  onDelete,
  onMove,
  onClose,
}: {
  step: WorkflowStep;
  stepIndex: number;
  totalSteps: number;
  agentOptions: Array<{ id: string; name: string }>;
  onConfigChange: (f: string, v: unknown) => void;
  onNameChange: (n: string) => void;
  onTypeChange: (t: WorkflowStep["type"]) => void;
  onDelete: () => void;
  onMove: (d: "up" | "down") => void;
  onClose: () => void;
}) {
  return (
    <ConfigShell
      title={`Step ${stepIndex + 1}`}
      icon={<StepIcon type={step.type} className="size-4" />}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          <button type="button" disabled={stepIndex === 0} onClick={() => onMove("up")}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:border-primary/30 hover:text-foreground disabled:opacity-30">
            <ArrowUp className="size-3" /> Up
          </button>
          <button type="button" disabled={stepIndex === totalSteps - 1} onClick={() => onMove("down")}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:border-primary/30 hover:text-foreground disabled:opacity-30">
            <ArrowDown className="size-3" /> Down
          </button>
          <button type="button" onClick={onDelete}
            className="ml-auto flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:border-destructive/40 hover:text-destructive">
            <Trash2 className="size-3" /> Delete
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">Step name</label>
          <input className={inputCls} value={step.name} onChange={(e) => onNameChange(e.target.value)} />
        </div>

        {/* Type */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Step type</p>
          <div className="grid grid-cols-2 gap-1">
            {STEP_TYPES.map((t) => (
              <button key={t.type} type="button"
                onClick={() => { if (t.type !== step.type) onTypeChange(t.type); }}
                className={`flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-[11px] font-medium transition
                  ${step.type === t.type ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"}`}
              >
                <StepIcon type={t.type} className="size-3" />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Monitor fields */}
        {step.type === "monitor" && (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground">What to monitor</label>
              <select className={inputCls} value={String(step.config.targetType ?? "url")}
                onChange={(e) => onConfigChange("targetType", e.target.value)}>
                <option value="url">Web page (URL)</option>
                <option value="keyword">Keyword / topic</option>
                <option value="company">Company</option>
                <option value="person">Person</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {String(step.config.targetType ?? "url") === "url" ? "URL" : "Target name"}
              </label>
              <input className={inputCls}
                placeholder={String(step.config.targetType ?? "url") === "url" ? "https://example.com" : "e.g. OpenAI, Sam Altman"}
                value={String(step.config.target ?? "")}
                onChange={(e) => onConfigChange("target", e.target.value)} />
              {String(step.config.targetType ?? "url") === "url" &&
               String(step.config.target ?? "").length > 0 &&
               !String(step.config.target ?? "").startsWith("http") && (
                <p className="mt-1 rounded-lg bg-[hsl(var(--badge-warning-bg))] px-2.5 py-1.5 text-[11px] text-[hsl(var(--badge-warning-text))]">
                  Include https:// — e.g. https://example.com
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Objective <span className="font-normal text-muted-foreground/60">(optional)</span>
              </label>
              <input className={inputCls} placeholder="What to watch for"
                value={String(step.config.objective ?? "")}
                onChange={(e) => onConfigChange("objective", e.target.value)} />
            </div>
            <p className="rounded-xl bg-primary/5 px-3 py-2 text-[11px] text-primary/80">
              ✦ Fetched content is automatically passed to the next agent step.
            </p>
          </>
        )}

        {/* Agent fields */}
        {step.type === "agent" && (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Agent</label>
              <select className={inputCls} value={String(step.config.agentId ?? "auto")}
                onChange={(e) => onConfigChange("agentId", e.target.value)}>
                <option value="auto">Auto (Let Gideon decide)</option>
                {agentOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Task instructions</label>
              <textarea className={`${inputCls} resize-none`} rows={4}
                placeholder={"Summarize the content and highlight key changes.\nUse {{variable}} for run-time inputs."}
                value={String(step.config.task ?? "")}
                onChange={(e) => onConfigChange("task", e.target.value)} />
            </div>
            <p className="rounded-xl bg-primary/5 px-3 py-2 text-[11px] text-primary/80">
              ✦ Previous step output is automatically passed as context.
              Use <code className="rounded bg-muted/60 px-0.5">{"{{variable}}"}</code> for run-time inputs.
            </p>
          </>
        )}

        {/* Artifact fields */}
        {step.type === "artifact" && (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Artifact type</label>
              <select className={inputCls} value={String(step.config.artifactType ?? "document")}
                onChange={(e) => onConfigChange("artifactType", e.target.value)}>
                <option value="document">Document</option>
                <option value="summary">Summary / Brief</option>
                <option value="report">Report</option>
                <option value="draft">Draft</option>
                <option value="data">Data / Insight</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Title <span className="font-normal text-muted-foreground/60">(optional)</span>
              </label>
              <input className={inputCls} placeholder="Leave blank to auto-generate"
                value={String(step.config.title ?? "")}
                onChange={(e) => onConfigChange("title", e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Content source</label>
              <select className={inputCls} value={String(step.config.contentSource ?? "previous_step")}
                onChange={(e) => onConfigChange("contentSource", e.target.value)}>
                <option value="previous_step">Previous step output</option>
                <option value="run_summary">Full run summary</option>
              </select>
            </div>
            <p className="rounded-xl bg-primary/5 px-3 py-2 text-[11px] text-primary/80">
              ✦ Saved to Library automatically.
            </p>
          </>
        )}

        {/* Context */}
        {step.type === "context" && (
          <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground leading-6">
            Loads workspace memory and recent artifacts as context for the next agent step. No configuration needed.
          </p>
        )}

        {/* Approval */}
        {step.type === "approval" && (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Approval policy</label>
              <select className={inputCls} value={String(step.config.policy ?? "external_only")}
                onChange={(e) => onConfigChange("policy", e.target.value)}>
                <option value="external_only">External actions only</option>
                <option value="any_member">Any write action</option>
              </select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              The run pauses here until you approve or reject.
            </p>
          </>
        )}

        {/* Notification */}
        {step.type === "notification" && (
          <div className="space-y-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Channel</label>
              <select className={inputCls} value={String(step.config.channel ?? "in_app")}
                onChange={(e) => onConfigChange("channel", e.target.value)}>
                <option value="in_app">In-app notification</option>
                <option value="system_email">Email me a Gideon notification</option>
              </select>
            </div>
            <p className="rounded-xl bg-primary/5 px-3 py-2 text-[11px] leading-5 text-primary/80">
              Gideon notification emails are delivered automatically to your verified account email and also saved in-app.
            </p>
          </div>
        )}

        {/* Conditional / If-Then */}
        {step.type === "conditional" && (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Condition</label>
              <select className={inputCls} value={String(step.config.condition ?? "output_not_empty")}
                onChange={(e) => onConfigChange("condition", e.target.value)}>
                <option value="output_not_empty">Previous step had output</option>
                <option value="monitor_changed">Monitor detected a change</option>
                <option value="output_contains">Output contains text…</option>
                <option value="always">Always pass (test / bypass)</option>
              </select>
            </div>
            {String(step.config.condition ?? "output_not_empty") === "output_contains" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Text to match</label>
                <input className={inputCls} placeholder="e.g. error, price, breaking"
                  value={String(step.config.value ?? "")}
                  onChange={(e) => onConfigChange("value", e.target.value)} />
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground">If condition fails</label>
              <select className={inputCls} value={String(step.config.onFalse ?? "stop")}
                onChange={(e) => onConfigChange("onFalse", e.target.value)}>
                <option value="stop">Stop — skip remaining steps</option>
                <option value="continue">Continue anyway</option>
              </select>
            </div>
            <p className="rounded-xl bg-primary/5 px-3 py-2 text-[11px] text-primary/80">
              ✦ When passing, the previous step&apos;s output flows through unchanged to downstream steps.
            </p>
          </>
        )}

        {/* Fetch URL */}
        {step.type === "fetch_url" && (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground">URL to fetch</label>
              <input className={inputCls} placeholder="https://example.com/page"
                value={String(step.config.url ?? "")}
                onChange={(e) => onConfigChange("url", e.target.value)} />
              {String(step.config.url ?? "").length > 0 && !String(step.config.url ?? "").startsWith("http") && (
                <p className="mt-1 rounded-lg bg-[hsl(var(--badge-warning-bg))] px-2.5 py-1.5 text-[11px] text-[hsl(var(--badge-warning-text))]">
                  Include https:// — e.g. https://example.com
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Objective <span className="font-normal text-muted-foreground/60">(optional)</span>
              </label>
              <input className={inputCls} placeholder="What to extract from this page"
                value={String(step.config.objective ?? "")}
                onChange={(e) => onConfigChange("objective", e.target.value)} />
            </div>
            <p className="rounded-xl bg-primary/5 px-3 py-2 text-[11px] text-primary/80">
              ✦ Extracts full page content and passes it to the next step. Unlike Monitor, this always fetches — no change detection.
            </p>
          </>
        )}
        {/* Integration Read */}
        {step.type === "integration.read" && (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Provider</label>
              <select className={inputCls} value={String(step.config.provider ?? "hubspot")}
                onChange={(e) => onConfigChange("provider", e.target.value)}>
                <option value="hubspot">HubSpot</option>
                <option value="salesforce">Salesforce</option>
                <option value="gmail">Gmail</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Entity or Query</label>
              <input className={inputCls} placeholder="e.g. contact email, deal name"
                value={String(step.config.query ?? "")}
                onChange={(e) => onConfigChange("query", e.target.value)} />
            </div>
            <p className="rounded-xl bg-primary/5 px-3 py-2 text-[11px] text-primary/80">
              ✦ Fetched data is automatically passed to the next agent step.
            </p>
          </>
        )}

        {/* Integration Action */}
        {step.type === "integration.action" && (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Provider</label>
              <select className={inputCls} value={String(step.config.provider ?? "hubspot")}
                onChange={(e) => onConfigChange("provider", e.target.value)}>
                <option value="hubspot">HubSpot</option>
                <option value="salesforce">Salesforce</option>
                <option value="gmail">Gmail</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Action</label>
              <select className={inputCls} value={String(step.config.actionType ?? step.config.operation ?? "create")}
                onChange={(e) => onConfigChange("actionType", e.target.value)}>
                <option value="create">Create Record</option>
                <option value="update">Update Record</option>
                <option value="delete">Delete Record</option>
                <option value="prepareSendApproval">Send outbound email through Gmail</option>
              </select>
            </div>
            <p className="rounded-xl bg-[hsl(var(--badge-warning-bg))] px-3 py-2 text-[11px] text-[hsl(var(--badge-warning-text))]">
              ✦ Actions requiring write permissions will automatically require user approval based on policy.
            </p>
          </>
        )}
      </div>
    </ConfigShell>
  );
}

function ConfigShell({
  title,
  icon,
  children,
  footer,
  onClose,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col border-l border-border bg-background">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 py-3.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <p className="flex-1 text-sm font-semibold">{title}</p>
        <button type="button" onClick={onClose}
          className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      {footer && <div className="shrink-0 border-t border-border px-4 py-3">{footer}</div>}
    </div>
  );
}

// ── Inner canvas (needs ReactFlowProvider context) ────────────────────────────

function WorkflowCanvasInner({
  steps,
  trigger,
  agentOptions,
  runDetail,
  onAddStep,
  onTriggerChange,
  onStepConfigChange,
  onStepNameChange,
  onStepTypeChange,
  onStepDelete,
  onStepMove,
  onStepsReorder,
  readonly = false,
}: WorkflowCanvasProps) {
  const { screenToFlowPosition } = useReactFlow();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const statusMap = new Map(
    (runDetail?.stepResults ?? []).map((s) => [s.stepId, s.status]),
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(
    buildNodes(steps, null, statusMap, positionsRef.current),
  );
  const [edges, setEdges] = useEdgesState(buildEdges(steps, statusMap));

  // Sync nodes/edges when steps or selection changes
  useEffect(() => {
    setNodes(buildNodes(steps, selectedId, statusMap, positionsRef.current));
    setEdges(buildEdges(steps, statusMap));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, selectedId, runDetail]);

  // Update trigger type label in trigger node data
  const triggerType = String(trigger.type ?? "manual");

  // Click handlers
  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedId((prev) => (prev === node.id ? null : node.id));
  }, []);

  // Drag stop: persist position, reorder by Y if step nodes
  const handleNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    positionsRef.current.set(node.id, node.position);

    if (node.id === "__trigger__") return;

    // Re-sort step nodes by Y to determine new order
    const allNodes = nodes.concat(); // snapshot
    const stepNodes = allNodes
      .filter((n) => n.id !== "__trigger__")
      .sort((a, b) => a.position.y - b.position.y);

    const newOrderedIds = stepNodes.map((n) => n.id);
    onStepsReorder?.(newOrderedIds);

    // Snap X back to center column, keep Y
    setNodes((prev) =>
      prev.map((n) =>
        n.id === "__trigger__"
          ? { ...n, position: { x: CENTER_X, y: positionsRef.current.get("__trigger__")?.y ?? 0 } }
          : { ...n, position: { x: CENTER_X, y: positionsRef.current.get(n.id)?.y ?? n.position.y } },
      ),
    );

    // Update edge connections
    setEdges(buildEdges(
      newOrderedIds.map((id) => steps.find((s) => s.id === id)).filter(Boolean) as WorkflowStep[],
      statusMap,
    ));
  }, [nodes, steps, statusMap, onStepsReorder, setNodes, setEdges]);

  // Drop from palette
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/steptype") as WorkflowStep["type"];
    if (!type) return;
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    // Store the drop position so the new node appears there
    const tempId = "__pending__";
    positionsRef.current.set(tempId, pos);
    onAddStep(type);
  }, [screenToFlowPosition, onAddStep]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const selectedStep = selectedId && selectedId !== "__trigger__"
    ? steps.find((s) => s.id === selectedId) ?? null
    : null;
  const selectedStepIndex = selectedStep ? steps.indexOf(selectedStep) : -1;
  const isTriggerSelected = selectedId === "__trigger__";

  const panelOpen = selectedId !== null;

  return (
    <div className="flex rounded-2xl border border-border overflow-hidden bg-[#f8f9fc]" style={{ minHeight: 520 }}>
      {/* Left palette */}
      {!readonly && (
        <div className="flex w-[88px] shrink-0 flex-col gap-1.5 border-r border-border bg-background px-2 py-3 overflow-y-auto" style={{ maxHeight: 520 }}>
          <p className="mb-1 px-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Steps</p>
        {STEP_TYPES.map((item) => (
          <div
            key={item.type}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/steptype", item.type);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => onAddStep(item.type)}
            className="flex cursor-grab flex-col items-center gap-1 rounded-xl border border-border bg-muted/20 p-2 text-center text-[10px] transition
              hover:border-primary/40 hover:bg-primary/5 hover:text-primary active:cursor-grabbing select-none"
          >
            <StepIcon type={item.type} className="size-3.5 text-muted-foreground" />
            <span className="leading-tight">{item.label}</span>
          </div>
        ))}

        {/* Coming soon divider */}
        <div className="my-1 flex items-center gap-1">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[8px] font-semibold uppercase tracking-widest text-muted-foreground/60">Soon</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {COMING_SOON_STEPS.map((item) => (
          <div
            key={item.label}
            title={`${item.label} — Coming Soon`}
            className="relative flex cursor-not-allowed flex-col items-center gap-1 rounded-xl border border-dashed border-border/50 bg-muted/10 p-2 text-center text-[10px] select-none opacity-55"
          >
            <span className="text-muted-foreground/70">{item.icon}</span>
            <span className="leading-tight text-muted-foreground/70">{item.label}</span>
            <span className="absolute -right-1 -top-1 rounded-full bg-amber-400/90 px-1 py-px text-[7px] font-bold uppercase leading-none tracking-wide text-amber-950 shadow-sm">
              Soon
            </span>
          </div>
        ))}

        <div className="mt-auto pt-1">
          <button
            type="button"
            onClick={() => onAddStep("agent")}
            className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-border p-2 text-[10px] text-muted-foreground transition hover:border-primary/30 hover:text-primary"
          >
            <Plus className="size-3.5" />
            <span>Add</span>
          </button>
        </div>
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 relative overflow-hidden">
        <ReactFlow
          nodes={nodes.map((n) => ({
            ...n,
            data: {
              ...(n.data as Record<string, unknown>),
              triggerType,
            },
          }))}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeClick={readonly ? undefined : handleNodeClick}
          onNodeDragStop={readonly ? undefined : handleNodeDragStop}
          onDrop={readonly ? undefined : handleDrop}
          onDragOver={readonly ? undefined : handleDragOver}
          nodesDraggable={!readonly}
          elementsSelectable={!readonly}
          selectNodesOnDrag={false}
          panOnDrag
          zoomOnScroll
          fitView
          fitViewOptions={{ padding: 0.35 }}
          minZoom={0.3}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
          style={{ background: "transparent" }}
        >
          <Background color="hsl(var(--border))" gap={24} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>

        {/* Empty state overlay */}
        {steps.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-40">
            <div className="text-center opacity-80">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-dashed border-border bg-white/50 backdrop-blur-sm shadow-sm">
                <GitBranch className="size-5 text-muted-foreground/50" />
              </div>
              <p className="mt-3 text-sm font-medium text-muted-foreground">No steps yet</p>
              <p className="mt-1 text-xs text-muted-foreground/70">Select a step type from the panel to get started</p>
            </div>
          </div>
        )}
      </div>

      {/* Right config panel */}
      {!readonly && (
        <div
          className={`shrink-0 overflow-hidden border-l border-border transition-[width] duration-200 ${
            panelOpen ? "w-72" : "w-0"
          }`}
        >
        {isTriggerSelected && (
          <TriggerConfigPanel
            trigger={trigger}
            onChange={onTriggerChange}
            onClose={() => setSelectedId(null)}
          />
        )}
        {selectedStep && (
          <StepConfigPanel
            step={selectedStep}
            stepIndex={selectedStepIndex}
            totalSteps={steps.length}
            agentOptions={agentOptions}
            onConfigChange={(f, v) => onStepConfigChange(selectedStep.id, f, v)}
            onNameChange={(n) => onStepNameChange(selectedStep.id, n)}
            onTypeChange={(t) => onStepTypeChange(selectedStep.id, t)}
            onDelete={() => { onStepDelete(selectedStep.id); setSelectedId(null); }}
            onMove={(d) => onStepMove(selectedStep.id, d)}
            onClose={() => setSelectedId(null)}
          />
        )}
        </div>
      )}
    </div>
  );
}

// ── Public export (wraps with ReactFlowProvider) ──────────────────────────────

export function WorkflowCanvasView(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
