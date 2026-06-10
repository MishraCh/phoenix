import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

export const firestoreTimestampSchema = z.custom<Timestamp>(
  (value) => value instanceof Timestamp,
  "Expected Firestore Timestamp",
);

export const workspaceRoleSchema = z.enum(["owner", "admin", "operator", "member", "viewer"]);
export const memberStatusSchema = z.enum(["active", "invited", "disabled"]);
export const planSchema = z.enum(["free", "plus", "pro"]);
export const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export const integrationProviderSchema = z.enum([
  "gmail",
  "google",
  "microsoft",
  "hubspot",
  "salesforce",
  "zoho",
  "slack",
  "notion",
  "drive",
  "stripe",
]);
export const integrationStatusSchema = z.preprocess((value) => {
  if (value === "needs_reconnect") {
    return "reconnect_needed";
  }

  if (value === "disabled") {
    return "disconnected";
  }

  return value;
}, z.enum([
  "connected",
  "expired",
  "reconnect_needed",
  "disconnected",
  "syncing",
  "error",
]));
// Firestore stores null for unset optional fields. Use nullish() + transform to
// coerce null → undefined so downstream code only sees T | undefined.
const nullish = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullish().transform((v) => v ?? undefined);

export const sourceRefSchema = z.object({
  sourceType: z.enum(["integration", "artifact", "web", "file", "memory"]),
  sourceId: z.string().min(1),
  title: nullish(z.string()),
  url: nullish(z.string().url()),
  provider: nullish(z.string()),
  // Accept Firestore Timestamp only; coerce null/undefined/strings (e.g. ISO from CommandResponse) to undefined
  fetchedAt: z.preprocess(
    (v) => (v instanceof Timestamp ? v : undefined),
    firestoreTimestampSchema.optional(),
  ),
  confidence: nullish(z.number().min(0).max(1)),
  // Accept any string for freshness and coerce unrecognised / null values to undefined
  freshness: z.preprocess(
    (v) => (v == null ? undefined : v),
    z.enum(["fresh", "stale", "partial", "missing"]).optional(),
  ),
  citations: z
    .array(
      z.object({
        title: nullish(z.string()),
        url: nullish(z.string().url()),
      }),
    )
    .nullish()
    .transform((v) => v ?? undefined),
  taskRunId: nullish(z.string()),
  sessionId: nullish(z.string()),
});

export const userSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  displayName: nullish(z.string()),
  photoURL: nullish(z.string().url().or(z.literal(''))),
  defaultWorkspaceId: nullish(z.string()),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

/**
 * Workspace Identity / AI context profile.
 * All fields are optional — an empty profile degrades gracefully.
 * Stored as a nested map under workspaces/{id}.profile in Firestore.
 */
export const workspaceProfileSchema = z.object({
  /** Primary company or product name (e.g. "BuildFast") */
  companyName: z.string().max(120).optional(),
  /** One-sentence description of what the company does */
  oneLiner: z.string().max(280).optional(),
  /** Ideal customer profile */
  icp: z.string().max(500).optional(),
  /** Key differentiators vs the competition */
  differentiators: z.string().max(800).optional(),
  /** Comma-separated primary competitors */
  primaryCompetitors: z.string().max(400).optional(),
  /** Market vertical / industry */
  industry: z.string().max(120).optional(),
  /** Company maturity stage */
  stage: z.enum(["idea", "pre-revenue", "early", "growth", "scale"]).optional(),
  /** Free-form overflow — anything that doesn't fit the named fields */
  additionalContext: z.string().max(2000).optional(),
  /** Preferred answer length/depth for AI responses */
  responseTone: z.enum(["concise", "balanced", "detailed"]).optional(),
  /** Free-form style guidance (e.g. "bullet points, no fluff, cite sources inline") */
  responseStyleNotes: z.string().max(500).optional(),
});
export type WorkspaceProfile = z.infer<typeof workspaceProfileSchema>;

export const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().optional(),
  ownerId: z.string().min(1),
  plan: planSchema,
  planSource: z.enum(["system", "coupon", "manual", "stripe"]),
  planExpiresAt: firestoreTimestampSchema.optional(),
  monthlyCreditsLimit: z.number().int().nonnegative(),
  monthlyCreditsUsed: z.number().int().nonnegative(),
  billingCycleStartAt: firestoreTimestampSchema,
  /** Stripe billing linkage (set by checkout webhook fulfillment) */
  stripeCustomerId: z.string().optional(),
  stripeSubscriptionId: z.string().optional(),
  defaultContextBundleId: z.string().optional(),
  /** Structured AI context about this workspace's business identity */
  profile: workspaceProfileSchema.optional(),
  channelsConfig: z.object({
    emailEnabled: z.boolean().default(false),
    whatsappEnabled: z.boolean().default(false),
  }).default({ emailEnabled: false, whatsappEnabled: false }),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export const integrationSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  provider: integrationProviderSchema,
  status: integrationStatusSchema,
  scopes: z.array(z.string()).default([]),
  scopesGranted: z.array(z.string()).optional(),
  tokenRef: nullish(z.string()),
  capabilities: z.array(z.string()),
  lastSyncedAt: nullish(firestoreTimestampSchema),
  syncError: nullish(z.string()),
  connectedBy: z.string().min(1),
  ownedByUserId: nullish(z.string().min(1)),
  accountEmail: nullish(z.string().email()),
  accountEmailLower: nullish(z.string().min(1)),
  portalId: nullish(z.number().int().positive()),
  connectionGeneration: z.number().int().nonnegative().default(1),
  tokenExpiresAt: nullish(firestoreTimestampSchema),
  refreshFailureAt: nullish(firestoreTimestampSchema),
  lastSuccessfulRefreshAt: nullish(firestoreTimestampSchema),
  lastErrorCode: nullish(z.string()),
  reconnectReason: nullish(z.string()),
  syncStatus: nullish(z.enum(["idle", "syncing", "error"])),
  watchHistoryId: nullish(z.string()),
  lastHistoryId: nullish(z.string()),
  watchExpiration: nullish(firestoreTimestampSchema),
  watchStatus: nullish(z.enum(["pending", "active", "expired", "error"])),
  lastWatchRenewedAt: nullish(firestoreTimestampSchema),
  lastDeltaSyncedAt: nullish(firestoreTimestampSchema),
  fullResyncRequired: nullish(z.boolean()),
  retentionDays: nullish(z.number().int().positive()),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export const integrationItemSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  integrationId: z.string().min(1),
  provider: z.string().min(1),
  sourceType: z.enum([
    "email",
    "email_thread",
    "calendar_event",
    "crm_contact",
    "crm_company",
    "crm_deal",
    "crm_note",
    "crm_task",
    "slack_message",
    "doc",
    "file",
  ]),
  externalId: z.string().min(1),
  title: z.string().optional(),
  normalizedData: z.record(z.string(), z.unknown()),
  summary: z.string().optional(),
  sourceHash: z.string().min(1),
  lastSyncedAt: firestoreTimestampSchema,
  lastProcessedAt: firestoreTimestampSchema.optional(),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
  expiresAt: nullish(firestoreTimestampSchema),
});

export const gmailStyleProfileSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  sampleSize: z.number().int().positive(),
  tone: z.string().min(1),
  formality: z.string().min(1),
  greetingStyle: z.string().min(1),
  signOffStyle: z.string().min(1),
  sentenceLength: z.string().min(1),
  commonPhrasing: z.array(z.string()).default([]),
  doPreferences: z.array(z.string()).default([]),
  dontPreferences: z.array(z.string()).default([]),
  summary: z.string().min(1),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export const workspaceMemberSchema = z.object({
  userId: z.string().min(1),
  workspaceId: z.string().min(1),
  role: workspaceRoleSchema,
  status: memberStatusSchema,
  invitedBy: z.string().optional(),
  joinedAt: firestoreTimestampSchema.optional(),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export const agentSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  type: z.enum(["executive", "sales", "research", "operations", "customer", "recruiting", "custom"]),
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["active", "paused", "needs_setup"]),
  toolsAllowed: z.array(z.string()),
  capabilitiesRequired: z.array(z.string()),
  approvalPolicy: z.enum(["always", "external_only", "low_risk_auto"]),
  tone: z.string().optional(),
  instructions: z.string().optional(),
  memoryEnabled: z.boolean(),
  createdBy: z.string().min(1),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export const agentRunSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  agentId: z.string().optional(),
  runType: z.enum(["command", "workflow_step", "scheduled", "manual"]),
  status: z.enum(["queued", "running", "waiting_approval", "completed", "failed", "cancelled"]),
  inputHash: z.string().optional(),
  promptVersion: z.string().optional(),
  model: z.string().optional(),
  tokenUsage: z
    .object({
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      totalTokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
  sourceRefs: z.array(sourceRefSchema),
  outputSummary: z.string().optional(),
  error: z.string().optional(),
  startedAt: firestoreTimestampSchema,
  completedAt: firestoreTimestampSchema.optional(),
  createdBy: z.string().optional(),
});

export const workflowTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("schedule"), cron: z.string(), timezone: z.string() }),
  z.object({ type: z.literal("integration_event"), provider: z.string(), eventType: z.string() }),
  z.object({ type: z.literal("condition"), condition: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("artifact"), artifactType: z.string() }),
]);

export const workflowStepSchema = z.object({
  id: z.string().min(1),
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
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  order: z.number().int().nonnegative(),
});

export const workflowSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(["template", "custom"]),
  status: z.enum(["draft", "active", "paused", "archived"]),
  trigger: workflowTriggerSchema,
  steps: z.array(workflowStepSchema),
  approvalPolicy: z.record(z.string(), z.unknown()),
  notificationPolicy: z.record(z.string(), z.unknown()),
  version: z.number().int().positive(),
  createdBy: z.string().min(1),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
  nextRunAt: firestoreTimestampSchema.optional(),
  lastRunAt: firestoreTimestampSchema.optional(),
});

export const workflowRunStepSchema = z.object({
  stepId: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["pending", "running", "completed", "failed", "skipped", "waiting_approval"]),
  startedAt: firestoreTimestampSchema.optional(),
  completedAt: firestoreTimestampSchema.optional(),
  outputSummary: z.string().optional(),
  error: z.string().optional(),
  approvalId: z.string().optional(),
  outputRef: z.string().optional(),
});

export const workflowRunSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  workflowId: z.string().min(1),
  status: z.enum(["queued", "running", "waiting_approval", "completed", "failed", "cancelled"]),
  currentStepId: z.string().optional(),
  progress: z.array(workflowRunStepSchema),
  inputSnapshot: z.record(z.string(), z.unknown()).optional(),
  outputSummary: z.string().optional(),
  artifactIds: z.array(z.string()).optional(),
  approvalIds: z.array(z.string()).optional(),
  error: z.string().optional(),
  dedupeKey: z.string().optional(),
  startedAt: firestoreTimestampSchema,
  completedAt: firestoreTimestampSchema.optional(),
  triggeredBy: z.enum(["user", "schedule", "integration", "system"]),
  triggeredByUserId: z.string().optional(),
  scheduledForAt: firestoreTimestampSchema.optional(),
});

export const proposedActionSchema = z.object({
  toolName: z.string().min(1),
  actionType: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  requiresApproval: z.boolean(),
  riskLevel: riskLevelSchema,
});

export const approvalSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  type: z.enum(["email_send", "crm_update", "crm_create", "crm_bulk", "slack_message", "task_create", "other"]),
  status: z.enum(["pending", "approved", "rejected", "edited", "executed", "failed", "cancelled"]),
  executionStatus: z.enum(["not_started", "executing", "executed", "failed"]).default("not_started"),
  executionLockId: z.string().optional(),
  executionStartedAt: firestoreTimestampSchema.optional(),
  executionCompletedAt: firestoreTimestampSchema.optional(),
  executionAttempts: z.number().int().min(0).default(0),
  executionResult: z.record(z.string(), z.unknown()).optional(),
  externalActionId: z.string().optional(),
  title: z.string().min(1),
  reason: z.string().min(1),
  preview: z.record(z.string(), z.unknown()),
  proposedAction: proposedActionSchema,
  riskLevel: riskLevelSchema,
  sourceRefs: z.array(sourceRefSchema),
  createdByAgentId: z.string().optional(),
  workflowId: z.string().optional(),
  workflowRunId: z.string().optional(),
  assignedTo: z.string().optional(),
  approvedBy: z.string().optional(),
  approvedAt: firestoreTimestampSchema.optional(),
  executedAt: firestoreTimestampSchema.optional(),
  idempotencyKey: z.string().min(1),
  wasEdited: z.boolean().optional(),
  error: z.string().optional(),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export const artifactSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  type: z.enum([
    "brief",
    "meeting_prep",
    "research_report",
    "draft",
    "workflow_output",
    "file_analysis",
    "saved_insight",
    "data",
    "document",
  ]),
  title: z.string().min(1),
  status: z.enum(["draft", "saved", "approved", "sent", "archived"]),
  content: z.record(z.string(), z.unknown()),
  textContent: z.string().optional(),
  sourceRefs: z.array(sourceRefSchema),
  inputHash: z.string().optional(),
  sourceHashes: z.array(z.string()).optional(),
  generatedByAgentId: z.string().optional(),
  workflowId: z.string().optional(),
  workflowRunId: z.string().optional(),
  creationSource: z
    .enum([
      "manual",
      "command_explicit",
      "workflow_step",
      "monitor",
      "integration_workspace",
      "saved_response_promotion",
      "legacy_unknown",
    ])
    .default("legacy_unknown"),
  sourceSessionId: z.string().optional(),
  sourceAssistantMessageId: z.string().optional(),
  createdBy: z.string().optional(),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
  expiresAt: firestoreTimestampSchema.optional(),
});

export const activityEventSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  actorType: z.enum(["user", "agent", "system"]),
  actorId: z.string().optional(),
  related: z.object({
    agentRunId: z.string().optional(),
    workflowId: z.string().optional(),
    workflowRunId: z.string().optional(),
    approvalId: z.string().optional(),
    artifactId: z.string().optional(),
    integrationId: z.string().optional(),
    personId: z.string().optional(),
  }),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: firestoreTimestampSchema,
});

export const notificationSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  userId: z.string().optional(),
  type: z.enum([
    "approval_needed",
    "workflow_completed",
    "workflow_failed",
    "report_ready",
    "integration_error",
    "missing_context",
    "agent_needs_setup",
  ]),
  title: z.string().min(1),
  body: z.string().optional(),
  status: z.enum(["unread", "read", "archived"]),
  actionUrl: z.string().optional(),
  related: z.record(z.string(), z.string()).optional(),
  createdAt: firestoreTimestampSchema,
  readAt: firestoreTimestampSchema.optional(),
});

export const contextBundleSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  key: z.string().min(1),
  purpose: z.string().min(1),
  inputHash: z.string().min(1),
  sourceRefs: z.array(sourceRefSchema),
  sourceHashes: z.array(z.string()),
  content: z.record(z.string(), z.unknown()),
  freshness: z.enum(["fresh", "stale", "partial", "missing"]),
  missingSources: z.array(z.string()).optional(),
  cacheVersion: z.string().default("context-bundle.v1"),
  sourceRevisions: z.record(z.string(), z.string()).default({}),
  providerConfigurationHash: z.string().optional(),
  connectionGenerationId: z.string().optional(),
  invalidationReason: z.string().optional(),
  expiresAt: firestoreTimestampSchema,
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export const usageRecordSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  userId: z.string().min(1).optional(),
  operationType: z.string().min(1),
  creditsCharged: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: firestoreTimestampSchema,
});

export const jobLockSchema = z.object({
  id: z.string().min(1),
  dedupeKey: z.string().min(1),
  workspaceId: z.string().min(1),
  jobType: z.string().min(1),
  status: z.enum(["queued", "running", "completed", "failed"]),
  runId: z.string().optional(),
  resultRef: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  startedAt: firestoreTimestampSchema.optional(),
  completedAt: firestoreTimestampSchema.optional(),
  expiresAt: firestoreTimestampSchema,
  attempts: z.number().int().min(0).default(0),
});

export const onboardingStateSchema = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  currentStep: z.number().int().min(0),
  completed: z.boolean(),
  sampleWorkspaceEnabled: z.boolean(),
  responses: z.record(z.string(), z.unknown()),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
  completedAt: firestoreTimestampSchema.optional(),
});

export const couponRedemptionSchema = z.object({
  id: z.string().min(1),
  couponCode: z.string().min(1),
  userId: z.string().min(1),
  workspaceId: z.string().min(1),
  planGranted: z.enum(["plus", "pro"]),
  creditsGranted: z.number().int().positive(),
  redeemedAt: firestoreTimestampSchema,
  expiresAt: firestoreTimestampSchema.optional(),
});

export const monitoredSourceSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  type: z.enum(["url", "keyword", "company", "person"]),
  value: z.string().min(1),
  frequency: z.enum(["daily", "weekly", "manual"]),
  status: z.enum(["active", "paused", "error"]),
  lastCheckedAt: firestoreTimestampSchema.optional(),
  lastChangedAt: firestoreTimestampSchema.optional(),
  lastContentHash: z.string().optional(),
  provider: z.string().optional(),
  workflowId: z.string().optional(),
  createdBy: z.string().min(1),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export const inviteCodeSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  workspaceId: z.string().min(1),
  roleGranted: z.enum(["admin", "operator", "member", "viewer"]),
  emailRestriction: z.string().email().optional(),
  maxUses: z.number().int().positive(),
  useCount: z.number().int().nonnegative(),
  status: z.enum(["active", "expired", "revoked"]),
  createdBy: z.string().min(1),
  expiresAt: firestoreTimestampSchema.optional(),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export const embeddingRecordSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  sourceType: z.enum([
    "artifact",
    "integration_item",
    "person",
    "context",
    "web_page",
    // Semantic architecture additions
    "expert_tool_sop",
    "session_summary",
    "memory_node",
    "workspace_profile",
  ]),
  sourceId: z.string().min(1),
  sourceHash: z.string().min(1),
  embeddingProvider: z.string().min(1),
  embeddingModel: z.string().min(1),
  dimensions: z.number().int().positive().optional(),
  vector: z.array(z.number()),
  chunkIndex: z.number().int().nonnegative().optional(),
  chunkText: z.string().optional(),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

// ---------------------------------------------------------------------------
// IndexedSource — unified retrieval store (semantic architecture §4.2)
// ---------------------------------------------------------------------------

export const indexedSourceTypeSchema = z.enum([
  "memory_fact",
  "artifact",
  "session_summary",
  "uploaded_document",
  "expert_tool_sop",
  "workflow_template",
  "gmail_thread_summary",
  "hubspot_record_summary",
  "integration_item_summary",
  "user_preference",
  "workspace_profile",
  "workflow_run_summary",
  "context_bundle",
]);

export const indexedSourcePermissionsSchema = z.object({
  scope: z.enum(["workspace", "user", "role"]),
  allowedUserIds: z.array(z.string()).optional(),
  allowedRoles: z.array(z.string()).optional(),
});

export const indexedSourceRetentionPolicySchema = z.object({
  type: z.enum(["temporary", "durable", "workspace_configurable"]),
  defaultDays: z.number().int().positive().optional(),
});

export const indexedSourceSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  userId: z.string().optional(),

  sourceType: indexedSourceTypeSchema,
  sourceId: z.string().min(1),
  sourceHash: z.string().min(1),
  schemaVersion: z.string().min(1),
  sourceRevision: z.string().optional(),
  connectionGenerationId: z.string().optional(),

  title: z.string().min(1),
  summary: z.string(),
  contentChunk: z.string(),
  chunkIndex: z.number().int().nonnegative().optional(),

  metadata: z.record(z.string(), z.unknown()),

  permissions: indexedSourcePermissionsSchema,

  provider: z.enum(["gmail", "hubspot", "internal", "upload", "workflow"]).optional(),

  freshness: z.enum(["fresh", "stale", "unknown"]).optional(),

  // number[] at TypeScript level; Firestore stores as VectorValue
  embedding: z.array(z.number()).optional(),

  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
  expiresAt: firestoreTimestampSchema.optional(),

  retentionPolicy: indexedSourceRetentionPolicySchema.optional(),

  deletedAt: firestoreTimestampSchema.optional(),
  deleteReason: z.string().optional(),
});

export const agentConfigSchema = z.object({
  agentId: z.string().min(1),
  workspaceId: z.string().min(1),
  status: z.enum(["active", "disabled", "needs_setup"]).optional(),
  systemPromptAddition: z.string().optional(),
  allowedTools: z.array(z.string()).nullable().optional(),
  contextBundleId: z.string().optional(),
  updatedAt: firestoreTimestampSchema.optional(),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

export type User = z.infer<typeof userSchema>;
export type Integration = z.infer<typeof integrationSchema>;
export type IntegrationItem = z.infer<typeof integrationItemSchema>;
export type IntegrationProviderId = z.infer<typeof integrationProviderSchema>;
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type WorkflowTrigger = z.infer<typeof workflowTriggerSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowRunStep = z.infer<typeof workflowRunStepSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type ActivityEvent = z.infer<typeof activityEventSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type ContextBundle = z.infer<typeof contextBundleSchema>;
export type UsageRecord = z.infer<typeof usageRecordSchema>;
export type JobLock = z.infer<typeof jobLockSchema>;
export type GmailStyleProfile = z.infer<typeof gmailStyleProfileSchema>;
export type OnboardingState = z.infer<typeof onboardingStateSchema>;
export type CouponRedemption = z.infer<typeof couponRedemptionSchema>;
export type InviteCode = z.infer<typeof inviteCodeSchema>;
export type MonitoredSource = z.infer<typeof monitoredSourceSchema>;
export type EmbeddingRecord = z.infer<typeof embeddingRecordSchema>;
export type IndexedSource = z.infer<typeof indexedSourceSchema>;
export type IndexedSourceType = z.infer<typeof indexedSourceTypeSchema>;

// ---------------------------------------------------------------------------
// Command Sessions
// ---------------------------------------------------------------------------

export const commandSessionModeSchema = z.enum(["default", "search", "research", "extract", "workflow"]);
export type CommandSessionMode = z.infer<typeof commandSessionModeSchema>;

export const commandSessionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  mode: commandSessionModeSchema,
  source: z.enum(["web", "email", "whatsapp", "api", "slack"]).default("web"),
  status: z.enum(["active", "archived"]),
  pinned: z.boolean().default(false),
  bookmarked: z.boolean().default(false),
  firstQuery: z.string(),
  lastMessagePreview: z.string(),
  turnCount: z.number().int().min(0).default(0),
  artifactIds: z.array(z.string()).default([]),
  sourceRefs: z.array(sourceRefSchema).default([]),
  summary: z.string().optional(),
  compressedContext: z.string().optional(),
  summaryStatus: z.enum(["idle", "queued", "completed", "failed"]).optional(),
  summaryAttempts: z.number().int().min(0).optional(),
  lastSummaryError: z.string().optional(),
  lastSummaryAttemptAt: firestoreTimestampSchema.optional(),
  sessionStateJson: z.string().optional(),
  sessionStateRevision: z.number().int().nonnegative().optional(),
  expiresAt: firestoreTimestampSchema.optional(),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});
export type CommandSession = z.infer<typeof commandSessionSchema>;

export const commandSessionMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  responseJson: z.string().optional(),
  mode: commandSessionModeSchema,
  source: z.enum(["web", "email", "whatsapp", "api", "slack"]).default("web"),
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  sourceRefs: z.array(sourceRefSchema).default([]),
  artifactIds: z.array(z.string()).default([]),
  starredByUserIds: z.array(z.string()).default([]),
  savedItemId: z.string().optional(),
  createdAt: firestoreTimestampSchema,
});
export type CommandSessionMessage = z.infer<typeof commandSessionMessageSchema>;

export const savedItemModeSchema = z.enum(["default", "search", "research", "extract", "workflow"]);
export const savedItemSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  sourceType: z.enum(["command_response", "workflow_run"]),
  sourceSessionId: z.string().optional(),
  sourceAssistantMessageId: z.string().optional(),
  sourceWorkflowRunId: z.string().optional(),
  itemType: z.enum(["saved_response"]),
  title: z.string().min(1),
  previewText: z.string(),
  contentText: z.string(),
  responseJson: z.string().optional(),
  mode: savedItemModeSchema.optional(),
  sourceRefs: z.array(sourceRefSchema).default([]),
  createdByUserId: z.string().min(1),
  promotedArtifactId: z.string().optional(),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});
export type SavedItem = z.infer<typeof savedItemSchema>;

// ---------------------------------------------------------------------------
// Workspace Memory
// ---------------------------------------------------------------------------

export const memoryNodeTypeSchema = z.enum(["fact", "preference", "pattern", "contact", "decision"]);
export const memoryNodeSourceSchema = z.enum(["session", "user", "command", "workflow"]);
export const memoryNodeStatusSchema = z.enum(["active", "needs_review", "archived"]);

export const memoryNodeSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  type: memoryNodeTypeSchema,
  content: z.string().min(1).max(2000),
  source: memoryNodeSourceSchema,
  sourceId: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.8),
  status: memoryNodeStatusSchema,
  sourceHash: z.string().optional(),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
  expiresAt: firestoreTimestampSchema.optional(),
});
export type MemoryNode = z.infer<typeof memoryNodeSchema>;
export type MemoryNodeType = z.infer<typeof memoryNodeTypeSchema>;
export type MemoryNodeSource = z.infer<typeof memoryNodeSourceSchema>;
export type MemoryNodeStatus = z.infer<typeof memoryNodeStatusSchema>;
