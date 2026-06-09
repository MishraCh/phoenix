import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";

export const workflowStepOutputSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  workflowId: z.string().min(1),
  workflowRunId: z.string().min(1),
  stepId: z.string().min(1),
  outputKind: z.enum([
    "answer",
    "expert",
    "integration_records",
    "approval",
    "artifact",
    "notification",
    "research",
    "context",
    "error",
  ]),
  schemaVersion: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  compactSummary: z.string(),
  sourceRefs: z.array(z.unknown()).default([]),
  artifactIds: z.array(z.string()).default([]),
  approvalIds: z.array(z.string()).default([]),
  status: z.enum(["completed", "failed", "partial"]),
  error: z.string().optional(),
  retryCount: z.number().int().nonnegative().default(0),
  createdAt: z.custom<Timestamp>((value) => value instanceof Timestamp),
  updatedAt: z.custom<Timestamp>((value) => value instanceof Timestamp),
});
export type WorkflowStepOutput = z.infer<typeof workflowStepOutputSchema>;

export async function writeWorkflowStepOutput(
  db: Firestore,
  input: Omit<WorkflowStepOutput, "id" | "createdAt" | "updatedAt">,
) {
  const ref = db
    .collection("workspaces")
    .doc(input.workspaceId)
    .collection("workflowRuns")
    .doc(input.workflowRunId)
    .collection("stepOutputs")
    .doc(input.stepId);
  const now = Timestamp.now();
  const output = workflowStepOutputSchema.parse({
    ...input,
    id: ref.id,
    createdAt: now,
    updatedAt: now,
  });
  await ref.set(output, { merge: true });
  return output;
}

export function formatWorkflowStepContext(output: WorkflowStepOutput | null | undefined) {
  if (!output) return "[Workflow step context: no prior structured output]";
  return JSON.stringify({
    schemaVersion: output.schemaVersion,
    outputKind: output.outputKind,
    compactSummary: output.compactSummary,
    payload: output.payload,
    sourceRefs: output.sourceRefs,
    artifactIds: output.artifactIds,
    approvalIds: output.approvalIds,
  });
}
