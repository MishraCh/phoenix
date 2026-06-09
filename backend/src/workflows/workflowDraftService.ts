import { createHash, randomUUID } from "node:crypto";

import type { CommandPlan } from "../ai/schemas/commandOutput.js";
import type { SessionStateSnapshot } from "../ai/contracts/sessionState.js";
import type { SourceRef } from "../schemas/coreSchemas.js";
import { validateCron } from "./workflowUtils.js";

export type WorkflowDeliveryIntent = "in_app" | "system_email" | "gmail_outbound";

export type BuildWorkflowDraftInput = {
  userQuery: string;
  timezone?: string | null;
  sessionState?: SessionStateSnapshot | null;
  sourceRefs?: SourceRef[];
  gmailConnected?: boolean;
  previousDraft?: Record<string, unknown> | null;
};

type WorkflowDraftStep = NonNullable<CommandPlan["workflowDraft"]>["steps"][number];

const WEEKDAY_TO_CRON: Record<string, string> = {
  sunday: "0",
  monday: "1",
  tuesday: "2",
  wednesday: "3",
  thursday: "4",
  friday: "5",
  saturday: "6",
};

function stableDraftId(seed: string) {
  return createHash("sha256").update(seed).digest("hex").slice(0, 24);
}

function normalizeTimezone(timezone?: string | null) {
  const candidate = timezone?.trim();
  if (!candidate) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return "UTC";
  }
}

function parseSchedule(query: string, timezone: string) {
  const lower = query.toLowerCase();
  const weekday = Object.keys(WEEKDAY_TO_CRON).find((day) => lower.includes(day));
  const timeMatch = lower.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  const hourRaw = timeMatch ? Number(timeMatch[1]) : 9;
  const minute = timeMatch?.[2] ? Number(timeMatch[2]) : 0;
  const meridian = timeMatch?.[3] ?? "am";
  const hour =
    meridian === "pm" && hourRaw < 12
      ? hourRaw + 12
      : meridian === "am" && hourRaw === 12
        ? 0
        : hourRaw;

  const cron = weekday
    ? `${minute} ${hour} * * ${WEEKDAY_TO_CRON[weekday]}`
    : /\b(daily|every day|each day)\b/i.test(query)
      ? `${minute} ${hour} * * *`
      : /\b(monthly|every month)\b/i.test(query)
        ? `${minute} ${hour} 1 * *`
        : "0 9 * * 1";

  return {
    type: "schedule" as const,
    cron,
    timezone,
    label: weekday
      ? `${weekday[0].toUpperCase()}${weekday.slice(1)} at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
      : "Scheduled recurring run",
  };
}

function extractCompanyName(query: string, sessionState?: SessionStateSnapshot | null) {
  const explicit =
    query.match(/\b(?:for|about|company(?:\s+name)?\s+is)\s+([a-z0-9][a-z0-9 .'-]{1,60}?)(?:[,.]|\s+(?:and|where|with|every|weekly|daily|domain|competitors?|funding)|$)/i)?.[1]
    ?? query.match(/\b([a-z0-9][a-z0-9 .'-]{1,40}\s+ai)\b/i)?.[1];

  if (explicit) {
    return explicit.trim().replace(/\s+/g, " ").replace(/\bai\b/i, "AI");
  }

  const activeCompany = sessionState?.activeEntities?.find((entity) =>
    /company|startup|account|organization/i.test(entity.objectType),
  );
  return activeCompany?.label ?? "your company";
}

function resolveDeliveryIntent(query: string): WorkflowDeliveryIntent {
  const lower = query.toLowerCase();
  const mentionsExternalRecipient =
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(query) ||
    /\b(customer|lead|team|sales team|teammate|client|prospect|jane|john)\b/i.test(lower);
  const mentionsGmail = /\b(gmail|from my gmail|through my gmail)\b/i.test(lower);

  if ((mentionsGmail || /\bsend\b/i.test(lower)) && mentionsExternalRecipient && !/\bemail me\b/i.test(lower)) {
    return "gmail_outbound";
  }

  if (/\b(email me|send me|notify me by email|notification in my email|email report|email notification)\b/i.test(lower)) {
    return "system_email";
  }

  return "in_app";
}

function hasSmtpConfiguration() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PASS && process.env.GIDEON_NOREPLY_EMAIL);
}

function makeAgentStep(id: string, order: number, name: string, task: string, inputStepIds: string[] = []): WorkflowDraftStep {
  return {
    id,
    type: "agent" as const,
    name,
    order,
    config: {
      agentId: "research",
      task,
      ...(inputStepIds.length ? { inputStepIds } : {}),
    },
  };
}

export function buildWorkflowDraftPlan(input: BuildWorkflowDraftInput): CommandPlan {
  const userQuery = input.userQuery.trim();
  const timezone = normalizeTimezone(input.timezone);
  const schedule = parseSchedule(userQuery, timezone);
  const companyName = extractCompanyName(userQuery, input.sessionState);
  const deliveryIntent = resolveDeliveryIntent(userQuery);
  const validationIssues: string[] = [];
  const clarificationQuestions: string[] = [];
  const previousDraft = input.previousDraft;

  if (!validateCron(schedule.cron, schedule.timezone)) {
    validationIssues.push(`The schedule could not be validated for timezone ${schedule.timezone}.`);
  }

  if (deliveryIntent === "system_email" && !hasSmtpConfiguration()) {
    validationIssues.push("Gideon system email is not fully configured; this workflow will still create in-app notifications.");
  }

  if (deliveryIntent === "gmail_outbound" && !input.gmailConnected) {
    validationIssues.push("Gmail is not connected. Outbound Gmail sends will require connecting Gmail before activation.");
  }

  if (previousDraft && Array.isArray(previousDraft["steps"])) {
    const previousTrigger = previousDraft["trigger"] as Record<string, unknown> | undefined;
    const previousConfig = previousTrigger?.["config"] as Record<string, unknown> | undefined;
    const priorDeliveryIntent =
      previousDraft["deliveryIntent"] === "system_email" ||
      previousDraft["deliveryIntent"] === "gmail_outbound" ||
      previousDraft["deliveryIntent"] === "in_app"
        ? previousDraft["deliveryIntent"]
        : "in_app";
    const hasNewDeliveryIntent = /\b(email me|notify me|gmail|send (?:it|this|the report) to|in-app|in app)\b/i.test(userQuery);
    const effectiveDeliveryIntent = hasNewDeliveryIntent ? deliveryIntent : priorDeliveryIntent;
    const hasNewScheduleIntent = /\b(every|each|daily|weekly|monthly|monday|tuesday|wednesday|thursday|friday|saturday|sunday|at\s+\d{1,2})\b/i.test(userQuery);
    const effectiveCron = hasNewScheduleIntent ? schedule.cron : String(previousConfig?.["cron"] ?? schedule.cron);
    const effectiveTimezone = hasNewScheduleIntent ? schedule.timezone : String(previousConfig?.["timezone"] ?? schedule.timezone);
    const allowedStepTypes = new Set<WorkflowDraftStep["type"]>([
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
    ]);
    const preservedSteps: WorkflowDraftStep[] = (previousDraft["steps"] as Array<Record<string, unknown>>).map((step, index) => {
      const rawType = typeof step["type"] === "string" ? step["type"] : "agent";
      const stepType = allowedStepTypes.has(rawType as WorkflowDraftStep["type"])
        ? rawType as WorkflowDraftStep["type"]
        : "agent";
      const config =
        step["config"] && typeof step["config"] === "object" && !Array.isArray(step["config"])
          ? { ...(step["config"] as Record<string, unknown>) }
          : {};
      if (step["type"] === "notification") {
        config["channel"] = effectiveDeliveryIntent === "system_email" ? "system_email" : "in_app";
        if (effectiveDeliveryIntent === "system_email") {
          config["recipient"] = "workflow_owner";
          config["includeInAppCopy"] = true;
        }
      }
      return {
        id: typeof step["id"] === "string" ? step["id"] : `draft-step-${index + 1}`,
        type: stepType,
        name: typeof step["name"] === "string" ? step["name"] : `Step ${index + 1}`,
        config,
        order: typeof step["order"] === "number" ? step["order"] : index,
      };
    });

    return {
      intent: "workflow",
      answer: "I updated the unsaved workflow draft. Review the changes before saving or activating it.",
      clarificationQuestion: null,
      highlights: [
        `${effectiveCron} (${effectiveTimezone})`,
        effectiveDeliveryIntent === "system_email"
          ? "Delivery: Gideon system email to your account plus in-app notification"
          : effectiveDeliveryIntent === "gmail_outbound"
            ? "Delivery: Gmail outbound email approval on each run"
            : "Delivery: in-app notification",
        "Still unsaved until you click Save Draft or Activate Workflow.",
      ],
      sections: [],
      artifact: null,
      approval: null,
      notification: null,
      workflowDraft: {
        draftId: typeof previousDraft["draftId"] === "string" ? previousDraft["draftId"] : stableDraftId(userQuery),
        name: typeof previousDraft["name"] === "string" ? previousDraft["name"] : `${companyName} recurring workflow`,
        description:
          typeof previousDraft["description"] === "string"
            ? previousDraft["description"]
            : `Recurring workflow for ${companyName}.`,
        triggerType: "schedule",
        cron: effectiveCron,
        timezone: effectiveTimezone,
        deliveryIntent: effectiveDeliveryIntent,
        validationIssues,
        clarificationQuestions,
        steps: preservedSteps,
      },
      requestedCapabilities: ["workflow_draft"],
      requestedTools: [],
      missingContext: validationIssues,
    };
  }

  const fundingStepId = "funding-deadline-research";
  const domainStepId = "domain-signal-research";
  const competitorStepId = "competitor-intelligence";
  const synthesisStepId = "synthesis";
  const artifactStepId = "save-report";
  const notificationStepId = "notify-owner";

  const steps: WorkflowDraftStep[] = [
    makeAgentStep(
      fundingStepId,
      0,
      "Funding and deadline research",
      `Find current grants, accelerators, VC programs, investor platforms, credits, and deadline-driven opportunities relevant to ${companyName}. Prioritize reputable programs and include deadlines, eligibility, fit, and next action.`,
    ),
    makeAgentStep(
      domainStepId,
      1,
      "AI and productivity SaaS market scan",
      `Research what's new in AI, agentic AI, digital employee, and productivity SaaS markets that matters for ${companyName}. Include launches, funding, performance signals, and strategic implications.`,
    ),
    makeAgentStep(
      competitorStepId,
      2,
      "Competitor performance watch",
      `Identify and monitor likely competitors or comparable companies for ${companyName}. Summarize funding, product launches, traction, positioning, and risks.`,
    ),
    makeAgentStep(
      synthesisStepId,
      3,
      "Compile executive report",
      `Create a concise executive report for ${companyName} using the prior research steps. Include the three requested sections, ranked priorities, source-backed highlights, and recommended actions.`,
      [fundingStepId, domainStepId, competitorStepId],
    ),
    {
      id: artifactStepId,
      type: "artifact" as const,
      name: "Save report to Library",
      order: 4,
      config: {
        artifactType: "report",
        title: `${companyName} weekly market and funding report`,
        contentSourceStepId: synthesisStepId,
      },
    },
    {
      id: notificationStepId,
      type: "notification" as const,
      name:
        deliveryIntent === "system_email"
          ? "Email me a Gideon notification"
          : "Create in-app notification",
      order: 5,
      config:
        deliveryIntent === "system_email"
          ? {
              channel: "system_email",
              recipient: "workflow_owner",
              contentSourceStepId: synthesisStepId,
              includeInAppCopy: true,
            }
          : {
              channel: "in_app",
              contentSourceStepId: synthesisStepId,
              includeInAppCopy: true,
            },
    },
  ];

  if (deliveryIntent === "gmail_outbound") {
    steps.push({
      id: "gmail-outbound-approval",
      type: "integration.action" as const,
      name: "Send outbound email through Gmail",
      order: steps.length,
      config: {
        provider: "gmail",
        operation: "prepareSendApproval",
        recipients: [],
        subjectSourceStepId: synthesisStepId,
        bodySourceStepId: synthesisStepId,
        requiresApproval: true,
      },
    });
    clarificationQuestions.push("Who should receive the outbound Gmail email?");
  }

  const draftId = stableDraftId(`${userQuery}:${timezone}:${JSON.stringify(steps)}`) || randomUUID();
  const sourceCount = input.sourceRefs?.length ?? 0;

  return {
    intent: "workflow",
    answer: `I drafted an unsaved recurring workflow for ${companyName}. Review the schedule, research steps, delivery channel, and validation notes before saving or activating it.`,
    clarificationQuestion: clarificationQuestions[0] ?? null,
    highlights: [
      `${schedule.label} (${schedule.timezone})`,
      deliveryIntent === "system_email"
        ? "Delivery: Gideon system email to your account plus in-app notification"
        : deliveryIntent === "gmail_outbound"
          ? "Delivery: Gmail outbound email approval on each run"
          : "Delivery: in-app notification",
      "No workflow has been saved or activated yet.",
    ],
    sections: [
      {
        title: "Draft behavior",
        body:
          "Each scheduled run gathers fresh evidence, compiles a report, saves an explicit workflow artifact, and notifies you. External Gmail sending is separate and always approval-gated.",
      },
    ],
    artifact: null,
    approval: null,
    notification: null,
    workflowDraft: {
      name: `${companyName} weekly funding and competitor report`,
      description:
        `Every scheduled run researches funding opportunities, domain movement, and competitor activity for ${companyName}, then compiles a report and notifies the workflow owner.`,
      triggerType: "schedule",
      cron: schedule.cron,
      timezone: schedule.timezone,
      draftId,
      deliveryIntent,
      validationIssues,
      clarificationQuestions,
      steps,
    },
    requestedCapabilities: ["workflow_draft", "web_research", "artifact_create", "notification_create"],
    requestedTools: [],
    missingContext: validationIssues,
  };
}

export function postProcessWorkflowDraft(
  draft: NonNullable<CommandPlan["workflowDraft"]>,
  query: string,
  timezone?: string | null
): NonNullable<CommandPlan["workflowDraft"]> {
  const normTimezone = normalizeTimezone(timezone || draft.timezone);
  const scheduleFallback = parseSchedule(query, normTimezone);

  let effectiveCron = draft.cron;
  if (draft.triggerType === "schedule" && !effectiveCron) {
    effectiveCron = scheduleFallback.cron;
  }

  const validationIssues = [...(draft.validationIssues || [])];
  if (draft.triggerType === "schedule" && effectiveCron) {
    if (!validateCron(effectiveCron, normTimezone)) {
      validationIssues.push(`The schedule could not be validated for timezone ${normTimezone}.`);
    }
  }

  let effectiveDeliveryIntent = draft.deliveryIntent;
  if (!effectiveDeliveryIntent) {
    effectiveDeliveryIntent = resolveDeliveryIntent(query);
  }

  if (effectiveDeliveryIntent === "system_email" && !hasSmtpConfiguration()) {
    validationIssues.push("Gideon system email is not fully configured; this workflow will still create in-app notifications.");
  }

  const draftId = draft.draftId || stableDraftId(`${query}:${normTimezone}:${JSON.stringify(draft.steps || [])}`) || randomUUID();

  // Ensure every step has an ID and a normalized type
  const steps = (draft.steps || []).map((step, index) => ({
    ...step,
    id: step.id || `step-${index + 1}`,
    order: typeof step.order === "number" ? step.order : index,
  }));

  return {
    ...draft,
    draftId,
    cron: effectiveCron,
    timezone: normTimezone,
    deliveryIntent: effectiveDeliveryIntent,
    validationIssues,
    steps,
  };
}
