import { z } from "zod";

export const commandModeSchema = z.enum(["auto", "search", "research", "extract_url", "workflow"]);
export type CommandMode = z.infer<typeof commandModeSchema>;

export const commandResultTypeSchema = z.enum([
  "answer",
  "search",
  "research",
  "extract_url",
  "workflow",
  "workflow_draft",
  "expert",
  "clarification",
  "capability_guide",
  "integration_records",
]);
export type CommandResultType = z.infer<typeof commandResultTypeSchema>;

export const commandSectionSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});

export const commandModeClassifierSchema = z.object({
  mode: commandModeSchema,
  reason: z.string().min(1),
});

export const commandPlanSchema = z.object({
  intent: z.enum(["brief", "draft", "approval", "workflow", "research", "search", "clarification", "other"]).catch("other"),
  answer: z.string().min(1).describe("A supportive, assistive conversational response. Briefly explain what you've done or drafted, confirming you understand their goal. Keep it helpful but avoid dumping raw JSON or step-by-step technical configuration here (save that for the structured fields)."),
  clarificationQuestion: z.string().min(1).nullish(),
  highlights: z.array(z.string().min(1)).default([]),
  sections: z.array(commandSectionSchema).default([]).describe("The main, substantive content broken down into logical sections. Use this for tables, lists, and detailed explanations."),
  artifact: z
    .object({
      title: z.string().min(1),
      artifactType: z.enum(["report", "draft", "summary", "data", "document"]),
      content: z.string().min(1),
    })
    .nullish(),
  approval: z
    .object({
      title: z.string().min(1),
      reason: z.string().min(1),
      type: z.enum(["email_send", "crm_update", "crm_create", "slack_message", "task_create", "other"]),
      actionType: z.string().min(1),
      toolName: z.string().min(1),
      input: z.record(z.string(), z.any()).optional(),
      riskLevel: z.enum(["low", "medium", "high", "critical"]),
    })
    .nullish(),
  notification: z
    .object({
      title: z.string().min(1),
      body: z.string().min(1).optional(),
      actionUrl: z.string().min(1).optional(),
    })
    .nullish(),
  workflowDraft: z
    .object({
      draftId: z.string().min(1).optional(),
      name: z.string().min(1),
      description: z.string().min(1).optional(),
      triggerType: z.enum(["manual", "schedule", "integration_event"]).default("manual"),
      cron: z.string().optional(),
      timezone: z.string().optional(),
      deliveryIntent: z.enum(["in_app", "system_email", "gmail_outbound"]).optional(),
      validationIssues: z.array(z.string().min(1)).default([]),
      clarificationQuestions: z.array(z.string().min(1)).default([]),
      steps: z.array(z.object({
        id: z.string().min(1).optional(),
        type: z.enum([
          "context",
          "agent",
          "tool",
          "approval",
          "action",
          "notification",
          "artifact",
          "monitor",
          "conditional",
          "fetch_url",
          "integration.read",
          "integration.action",
        ]),
        name: z.string(),
        config: z.record(z.string(), z.any()),
        order: z.number().int().nonnegative().optional(),
        inputStepIds: z.array(z.string().min(1)).optional(),
      })).describe(
        "The steps of the workflow. Design a logical, complete pipeline that fully achieves the user's goal. Ensure all necessary steps (e.g., retrieving data, processing it, and notifying the user) are included without adding unnecessary bloat. " +
        "CRITICAL MAPPING RULES for Supported Step Types (DO NOT use 'tool' or 'action' types): " +
        "1. For AI tasks, research, search, or generation: use type='agent' and config={ task: 'Strict instruction for the agent (e.g., \"Research XYZ\"). DO NOT put conversational answers or \"I drafted...\" text here.', agentId: 'auto' }. " +
        "2. For fetching a specific URL: use type='fetch_url' and config={ url: 'https...', objective: 'what to extract' }. " +
        "3. For Gideon system email notifications to the workflow owner: use type='notification' and config={ channel: 'system_email', recipient: 'workflow_owner', includeInAppCopy: true }. For ordinary in-app alerts use channel='in_app'. " +
        "4. Outbound Gmail and Salesforce steps are COMING SOON — NEVER use provider 'gmail', 'google', or 'salesforce' in integration steps. If the user asks to email someone externally, add a system_email notification to the workflow owner instead and note the limitation. HubSpot integration steps (provider 'hubspot') are fully supported. " +
        "5. For saving a report/summary: use type='artifact' and config={ artifactType: 'report', title: '...' }. " +
        "6. For monitoring a topic/URL: use type='monitor' and config={ targetType: 'keyword', target: '...', objective: '...' }. " +
        "7. For scheduled workflows, NEVER use {{variables}} in configs as they cannot be provided during automated runs. " +
        "NEVER invent unsupported step types or configurations."
      ),
    })
    .nullish(),
  requestedCapabilities: z.array(z.string()).default([]),
  requestedTools: z.array(z.string()).default([]),
  missingContext: z.array(z.string()).default([]),
});

export type CommandPlan = z.infer<typeof commandPlanSchema>;

export const threadSummaryCardSchema = z.object({
  threadId: z.string().optional(),
  summary: z.string().describe("Executive summary of the email thread"),
  decisions: z.array(z.string()).describe("Key decisions or conclusions reached"),
  actionItems: z.array(
    z.object({
      owner: z.string(),
      task: z.string(),
    })
  ).describe("Pending action items extracted from the thread"),
  suggestedNextSteps: z.array(z.string()).describe("Recommendations for the user's next action"),
});

export const draftReplyCardSchema = z.object({
  threadId: z.string().optional(),
  to: z.array(z.string()).optional(),
  subject: z.string().optional(),
  body: z.string().describe("The drafted email body"),
  toneUsed: z.string().describe("The tone applied to the draft, e.g., 'professional', 'casual'"),
});
export const relationshipInsightCardSchema = z.object({
  contactId: z.string().optional(),
  name: z.string(),
  company: z.string().optional(),
  lastContactDate: z.string().optional(),
  relationshipHealth: z.enum(["strong", "neutral", "at_risk", "unknown"]),
  keyInsights: z.array(z.string()).describe("Important context from past interactions"),
  suggestedTouchpoints: z.array(z.string()).describe("Ideas for next outreach"),
});

export const preMeetingBriefCardSchema = z.object({
  meetingTitle: z.string(),
  attendees: z.array(z.string()).describe("List of people attending"),
  agenda: z.array(z.string()).describe("Meeting agenda or goals"),
  context: z.string().describe("Background information for the meeting"),
  recommendedTalkingPoints: z.array(z.string()).describe("Key points the user should bring up"),
  redFlags: z.array(z.string()).describe("Potential risks or issues to watch out for"),
});

export const grantShortlistCardSchema = z.object({
  title: z.string().describe("Name of the grant or funding program"),
  url: z.string().url().describe("Official URL for the program"),
  region: z.string().describe("Target geography or eligibility area"),
  amount: z.string().describe("Funding amount or benefit description"),
  deadline: z.string().describe("Application deadline or status"),
  fitScore: z.number().min(1).max(100).describe("Estimated fit score (1-100)"),
  fitReasoning: z.string().describe("Why this is a good fit for the company"),
  nextAction: z.string().describe("Suggested next steps to apply or verify"),
});

export const commitmentConfirmationCardSchema = z.object({
  commitmentType: z.string().describe("Type of commitment (e.g., 'send proposal', 'schedule meeting')"),
  dueDate: z.string().describe("Extracted due date or time frame"),
  context: z.string().describe("Context around the commitment"),
  suggestedAction: z.string().describe("Suggested action to fulfill the commitment"),
});

export const genericStructuredExpertSchema = z.object({
  status: z
    .enum(["ready", "success", "partial", "missing_context", "not_found", "connection_missing", "permission_missing", "error"])
    .default("ready"),
  title: z.string().min(1).optional(),
  summary: z.string().min(1),
  score: z
    .object({
      label: z.string().min(1),
      value: z.number().min(0).max(100),
      explanation: z.string().min(1).optional(),
    })
    .optional(),
  sections: z
    .array(
      z.object({
        title: z.string().min(1),
        body: z.string().min(1).optional(),
        bullets: z.array(z.string().min(1)).default([]),
      }),
    )
    .default([]),
  table: z
    .object({
      columns: z.array(z.string().min(1)).min(1),
      rows: z.array(z.array(z.string())).default([]),
    })
    .optional(),
  checklist: z.array(z.string().min(1)).default([]),
  timeline: z
    .array(
      z.object({
        label: z.string().min(1),
        detail: z.string().min(1),
      }),
    )
    .default([]),
  risks: z.array(z.string().min(1)).default([]),
  recommendations: z.array(z.string().min(1)).default([]),
  nextActions: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1).optional(),
  searchMetadata: z
    .object({
      query: z.string().optional(),
      sourceUsed: z.string().optional(),
      missingData: z.array(z.string()).optional(),
    })
    .optional(),
});
