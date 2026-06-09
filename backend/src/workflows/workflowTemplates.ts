import type { WorkflowStep, WorkflowTrigger } from "../schemas/coreSchemas.js";

export type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
};

export const workflowTemplates: WorkflowTemplate[] = [
  {
    id: "template_morning_command_brief",
    name: "Morning command brief",
    description: "Prepare a daily operating brief from cached context, approvals, active runs, and recent artifacts.",
    trigger: { type: "schedule", config: { cron: "0 8 * * 1-5" } } as any,
    steps: [
      {
        id: "context_daily_snapshot",
        type: "context",
        name: "Gather workspace snapshot",
        order: 0,
        config: { sources: ["dashboard", "activity", "approvals", "artifacts"] },
      },
      {
        id: "agent_executive_summary",
        type: "agent",
        name: "Executive Assistant prepares brief",
        order: 1,
        config: { agentId: "executive", task: "Summarize priorities and open loops" },
      },
      {
        id: "artifact_save_brief",
        type: "artifact",
        name: "Save brief to Library",
        order: 2,
        config: { artifactType: "brief" },
      },
      {
        id: "notification_ready",
        type: "notification",
        name: "Morning Brief is ready",
        order: 3,
        config: { 
          channel: "in_app",
          title: "Morning Brief Ready",
          body: "Your daily operating brief has been compiled.",
          type: "report_ready"
        },
      },
    ],
  },
];

workflowTemplates.push({
  id: "template_monitor_url",
  name: "Monitor URL for changes",
  description:
    "Check a public URL for meaningful content changes. Creates a report and notifies you when a change is detected.",
  trigger: { type: "manual" },
  steps: [
    {
      id: "monitor_url_check",
      type: "monitor",
      name: "Check URL for changes",
      order: 0,
      config: {
        targetType: "url",
        target: "https://example.com",
        objective: "Detect meaningful content changes",
        processor: "core",
      },
    },
  ],
});

workflowTemplates.push({
  id: "template_monitor_company",
  name: "Monitor company for news",
  description:
    "Track a company for meaningful new public information. Creates a sourced report when changes are detected.",
  trigger: { type: "manual" },
  steps: [
    {
      id: "monitor_company_check",
      type: "monitor",
      name: "Check company for new information",
      order: 0,
      config: {
        targetType: "company",
        target: "Acme Corp",
        objective: "Detect meaningful new public information",
        processor: "core",
      },
    },
  ],
});

workflowTemplates.push({
  id: "template_signal_monitoring",
  name: "Signal-to-Opportunity Monitoring",
  description: "Monitor a key account for major news or funding events. Pauses for human review to draft value-led outreach when a signal is detected.",
  trigger: { type: "schedule", config: { cron: "0 8 * * 1-5" } } as any,
  steps: [
    {
      id: "signal_monitor_company",
      type: "monitor",
      name: "Check company for major signals",
      order: 0,
      config: {
        targetType: "company",
        target: "Acme Corp",
        objective: "Detect major funding rounds, leadership changes, or product launches",
        processor: "core",
      },
    },
    {
      id: "signal_evaluate_approval",
      type: "approval",
      name: "Pause for human review",
      order: 1,
      config: {
        title: "High-value signal detected",
        reason: "Review the news and approve drafting an outreach email.",
        type: "other",
        actionType: "draft_outreach",
        toolName: "gmail.prepareSendApproval",
        riskLevel: "medium",
      },
    },
  ],
});

export function getWorkflowTemplate(templateId: string) {
  return workflowTemplates.find((template) => template.id === templateId) ?? null;
}
