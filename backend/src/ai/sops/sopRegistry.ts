import type { Firestore } from "firebase-admin/firestore";

export type SOP = {
  id: string;
  domain: string;
  title: string;
  intentKeywords: string[];
  content: string;
};

// Hardcoded system SOPs. In the future, this can be moved to Firestore for user-defined SOPs.
// NOTE: The universal persona SOP was removed — persona is handled by the compact manifest.
const SYSTEM_SOPS: SOP[] = [
  {
    id: "sop_email_compose",
    domain: "communications",
    title: "Email Compose Rules",
    intentKeywords: [
      "send email", "email", "write to", "reach out", "ping", "follow up", 
      "shoot a message", "drop a line", "get in touch", "contact by email"
    ],
    content: `[EMAIL COMPOSE RULE — CRITICAL]
If the user asks to send or draft an email, call gmail.prepareSendApproval immediately.
NEVER say 'go to the Gmail workspace to compose' — create the approval inline in this chat.
NEVER refuse to create an approval because no threadId is available — threadId is OPTIONAL.
  • New outbound email (no existing thread): {to: [...], subject: '...', body: '...'}
  • Reply to existing thread: {threadId: '...', to: [...]} — subject/body auto-drafted if omitted.
Draft the subject and body yourself using the user's intent. 
IMPORTANT: Always consult Workspace Memory to capture the user's preferred tone and style. If available, use the listSentMessagesForStyle capability/context to mimic their authentic voice before calling gmail.prepareSendApproval.`
  },
  {
    id: "sop_email_summary",
    domain: "communications",
    title: "Email Thread Summarization Rules",
    intentKeywords: [
      "summarize thread", "catch me up on email", "what is this email about", 
      "tldr email", "summarize email"
    ],
    content: `[EMAIL SUMMARY RULE]
When the user asks to summarize an email thread:
1. Extract key facts, decisions made, and pending action items.
2. Identify who needs to take the next step.
3. Keep the summary structured and concise.
4. Output the information clearly using sections or bullet points.`
  },
  {
    id: "sop_crm_update",
    domain: "operations",
    title: "CRM Update Rules",
    intentKeywords: ["update", "hubspot", "salesforce", "crm", "change", "deal", "contact", "company"],
    content: `[CRM UPDATE RULE]
Use hubspot.prepareUpdateApproval for HubSpot CRM update approval requests.
Use hubspot.prepareCreateApproval for HubSpot CRM create approval requests.
Use hubspot.prepareNoteApproval to add a real HubSpot note to the selected record.
Use hubspot.prepareTaskCreateApproval or hubspot.prepareTaskUpdateApproval for real HubSpot task actions.
Use hubspot.prepareAssociationApproval for relationship changes between CRM objects.
HubSpot uses bounded live CRM reads plus approval-gated writes. Prefer selected-record context and do not imply full CRM mirroring.`
  },
  {
    id: "sop_research_limits",
    domain: "research",
    title: "Web Research Guidelines",
    intentKeywords: ["search", "find", "research", "look up", "who is", "what is", "scrape"],
    content: `[RESEARCH LIMITATIONS]
Web research uses Parallel Task — public sources only, no authenticated/paywalled access.
URL extraction uses Parallel Extract — public URLs only.
Do not invent facts. If the research fails or times out, state that clearly.`
  },
  {
    id: "sop_relationship_assistance",
    domain: "relationships",
    title: "Relationship & Contact Context Rules",
    intentKeywords: ["who is", "contact info", "relationship", "how do i know", "when did we last speak", "background on"],
    content: `[RELATIONSHIP ASSISTANCE RULE]
When the user asks for context or background on a person/company:
1. Prioritize Workspace Memory and HubSpot CRM data.
2. Summarize key facts, last interactions, and any pending deals/tasks.
3. Determine relationship health based on recent sentiment and cadence.
4. Suggest a logical next touchpoint if the relationship is 'at_risk' or 'neutral'.`
  },
  {
    id: "sop_pre_meeting_brief",
    domain: "preparation",
    title: "Pre-Meeting Brief Rules",
    intentKeywords: ["prep me", "meeting prep", "get me ready for", "brief me on my meeting", "upcoming meeting"],
    content: `[PRE-MEETING BRIEF RULE]
When the user asks for meeting preparation:
1. Gather context from recent emails (Gmail) and CRM records (HubSpot).
2. Synthesize an agenda and key talking points.
3. Highlight any recent wins or potential red flags.
4. Provide actionable advice for steering the conversation.`
  },
  {
    id: "sop_grant_research",
    domain: "research",
    title: "Grant & Funding Research Rules",
    intentKeywords: ["grant", "funding", "find money", "apply for", "subsidies"],
    content: `[GRANT RESEARCH RULE]
When the user asks to find grants, funding, or subsidies:
1. Prioritize official program domains (e.g., .gov, official foundations).
2. For each opportunity, extract: Region/Eligibility, Amount/Benefit, Deadline/Status.
3. Compute a Fit Score (1-100) based on the workspace context.
4. Output a clear recommendation or next action.`
  },
  {
    id: "sop_commitment_extraction",
    domain: "operations",
    title: "Commitment Extraction Rules",
    intentKeywords: ["summarize thread", "send email", "draft reply", "what did i say"],
    content: `[COMMITMENT EXTRACTION RULE]
When summarizing an email thread or after the user drafts/sends a communication:
1. Monitor the text for future commitments (e.g., "I will send this tomorrow", "Let's meet Friday").
2. Extract the commitment type, due date, and context.
3. If a commitment is detected, propose creating a tracked reminder or task.`
  },
  {
    id: "sop_account_snapshot",
    domain: "intelligence",
    title: "Account Snapshot & Profiling Rules",
    intentKeywords: ["account overview", "account snapshot", "company profile", "profile on", "account profile", "summarize account"],
    content: `[ACCOUNT SNAPSHOT RULE]
When the user asks for an overview, snapshot, or profile of an account/company:
1. Aggregate data from all connected systems: pull recent Gmail history, HubSpot CRM notes/deal stages, and Workspace Memory.
2. If web research is available (or triggered), include recent public signals.
3. Synthesize this data into a comprehensive account profile.
4. Output MUST map to the account_snapshot expert card format.`
  }
];

export class SopRegistryService {
  constructor(private readonly db: Firestore) {}

  /**
   * Retrieves relevant SOPs based on a naive keyword match against the user's input.
   * In a future phase, this can be upgraded to an embedding-based semantic search.
   */
  async retrieveRelevantSops(input: string): Promise<SOP[]> {
    const normalizedInput = input.toLowerCase();
    const matchedSops: SOP[] = [];

    for (const sop of SYSTEM_SOPS) {
      if (sop.intentKeywords.some(keyword => normalizedInput.includes(keyword))) {
        matchedSops.push(sop);
      }
    }

    return matchedSops
      .sort((a, b) => {
        const score = (sop: SOP) =>
          sop.intentKeywords.filter((keyword) => normalizedInput.includes(keyword)).length;
        return score(b) - score(a);
      })
      .slice(0, 2);
  }

  /**
   * Builds a formatted prompt block containing the retrieved SOPs.
   */
  formatSopsForPrompt(sops: SOP[]): string {
    if (sops.length === 0) return "";
    
    const rules = sops.map(sop => sop.content).join("\n\n");
    return `[STANDARD OPERATING PROCEDURES (SOPs)]\nThe following rules apply to your current task based on the user's intent:\n\n${rules}`;
  }
}
