import type { Firestore } from "firebase-admin/firestore";

import type { CommandPlan } from "../../ai/schemas/commandOutput.js";
import type { ExpertSelectedItem } from "../../experts/types.js";
import type { CurrentWorkspace } from "../../services/currentWorkspaceService.js";
import { ApiError } from "../../utils/apiError.js";
import { IntegrationWorkspaceService } from "../integrationWorkspaceService.js";

export type GmailApprovalInput = {
  threadId?: string;
  to: string[];
  subject: string;
  body: string;
};

export type GmailActionPreparation =
  | {
      status: "ready";
      approvalId: string;
      subject: string;
      label: string;
      actionType: "email_send";
    }
  | {
      status: "missing_fields" | "unavailable";
      message: string;
    };

function extractEmailAddresses(text: string) {
  return Array.from(
    new Set(
      (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
        .map((value) => value.trim().toLowerCase()),
    ),
  );
}

function parseEmailDraftFromText(text: string) {
  const subjectMatch = text.match(/(?:^|\n)\s*(?:subject|email subject)\s*:\s*(.+)/i);
  const bodyStart = subjectMatch?.index === undefined
    ? -1
    : subjectMatch.index + subjectMatch[0].length;
  const body = bodyStart >= 0
    ? text.slice(bodyStart).replace(/^\s+/, "").trim()
    : text.trim();

  return {
    subject: subjectMatch?.[1]?.trim() || null,
    body: body.length >= 8 ? body : null,
  };
}

function extractDraft(plan: CommandPlan, sessionContext: string) {
  const preferredSections = plan.sections
    .filter(
      (section) =>
        /\b(draft|email|reply|message)\b/i.test(section.title) ||
        /(?:^|\n)subject:\s*/i.test(section.body),
    )
    .map((section) => section.body);
  const candidates = [
    ...preferredSections,
    plan.artifact?.content ?? "",
    plan.answer,
    sessionContext,
  ].filter((value) => value.trim());

  for (const candidate of candidates) {
    const parsed = parseEmailDraftFromText(candidate);
    if (parsed.subject && parsed.body) return parsed;
  }
  return { subject: null, body: null };
}

export function resolveGmailApprovalInput(input: {
  userInput: string;
  sessionContext: string;
  plan: CommandPlan;
  selectedItem: ExpertSelectedItem | null;
}): GmailApprovalInput | { message: string } {
  const recipients = extractEmailAddresses(`${input.userInput}\n${input.sessionContext}`);
  const draft = extractDraft(input.plan, input.sessionContext);
  const selectedThread =
    input.selectedItem?.provider === "gmail" &&
    input.selectedItem.itemType === "email_thread"
      ? input.selectedItem.itemId
      : undefined;

  if (!recipients.length && !selectedThread) {
    return {
      message:
        "Add the recipient email address, or select the Gmail thread you want to reply to.",
    };
  }

  if (!draft.subject || !draft.body) {
    return {
      message:
        "I need a final subject and email body before I can prepare the send approval.",
    };
  }

  return {
    ...(selectedThread ? { threadId: selectedThread } : {}),
    to: recipients,
    subject: draft.subject,
    body: draft.body,
  };
}

export class GmailActionService {
  private readonly workspaceService: IntegrationWorkspaceService;

  constructor(db: Firestore) {
    this.workspaceService = new IntegrationWorkspaceService(db);
  }

  async prepareSend(input: {
    currentWorkspace: CurrentWorkspace;
    userId: string;
    userInput: string;
    sessionContext: string;
    plan: CommandPlan;
    selectedItem: ExpertSelectedItem | null;
  }): Promise<GmailActionPreparation> {
    const resolved = resolveGmailApprovalInput(input);
    if ("message" in resolved) {
      return { status: "missing_fields", message: resolved.message };
    }

    try {
      const approval = await this.workspaceService.prepareGmailSendApproval(
        input.currentWorkspace,
        input.userId,
        resolved,
      );
      return {
        status: "ready",
        approvalId: approval.approvalId,
        subject: approval.subject,
        label: `Send Gmail email: ${approval.subject}`,
        actionType: "email_send",
      };
    } catch (error) {
      if (error instanceof ApiError) {
        return { status: "unavailable", message: error.message };
      }
      throw error;
    }
  }
}
