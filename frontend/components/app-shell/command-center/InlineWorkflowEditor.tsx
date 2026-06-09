"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Save } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { gideonQueryKeys, useAgentsQuery, useWorkflowDetailQuery } from "@/hooks/useGideonQueries";
import { createWorkflow, saveWorkflow, updateWorkflowStatus, type WorkflowStep } from "@/services/workflows";
import { WorkflowCanvasView } from "../WorkflowCanvas";
import { Button } from "@/components/ui/button";

export type InlineWorkflowDraft = {
  draftId: string;
  name: string;
  description?: string | null;
  trigger: Record<string, unknown>;
  deliveryIntent?: "in_app" | "system_email" | "gmail_outbound";
  steps: WorkflowStep[];
  validationIssues?: string[];
  clarificationQuestions?: string[];
};

function describeDraftSchedule(trigger: Record<string, unknown>) {
  const config = (trigger.config as Record<string, unknown> | undefined) ?? {};
  if (trigger.type === "schedule" || trigger.type === "scheduled") {
    return `${String(config.cron ?? "0 9 * * *")} · ${String(config.timezone ?? "UTC")}`;
  }
  return "Manual trigger";
}

function describeDelivery(intent?: InlineWorkflowDraft["deliveryIntent"]) {
  if (intent === "system_email") {
    return {
      label: "Email me a Gideon notification",
      helper: "Delivered automatically to your verified account email. No Gmail approval needed.",
    };
  }
  if (intent === "gmail_outbound") {
    return {
      label: "Send outbound email through Gmail",
      helper: "Creates a Gmail send approval on every scheduled run.",
    };
  }
  return {
    label: "In-app notification",
    helper: "Posted inside Gideon when the workflow finishes.",
  };
}

export function InlineWorkflowEditor({
  workflowId,
  draft,
}: {
  workflowId?: string | null;
  draft?: InlineWorkflowDraft | null;
}) {
  const { idToken } = useAuth();
  const queryClient = useQueryClient();
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [trigger, setTrigger] = useState<Record<string, unknown>>({ type: "manual", config: {} });
  const [isSaved, setIsSaved] = useState(false);
  const [savedWorkflowId, setSavedWorkflowId] = useState<string | null>(workflowId ?? null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: workflowDetail, isLoading, isError, error } = useWorkflowDetailQuery(workflowId ?? null);

  const { data: agentsData } = useAgentsQuery();
  const agentOptions = (agentsData?.agents ?? []).map((a) => ({ id: a.id, name: a.name }));

  useEffect(() => {
    if (workflowDetail) {
      setSteps(workflowDetail.steps ?? []);
      setTrigger(workflowDetail.trigger ?? { type: "manual", config: {} });
    }
  }, [workflowDetail]);

  useEffect(() => {
    if (draft && !workflowId) {
      setSteps(draft.steps ?? []);
      setTrigger(draft.trigger ?? { type: "manual", config: {} });
      setSavedWorkflowId(null);
      setIsSaved(false);
    }
  }, [draft, workflowId]);

  const saveMutation = useMutation({
    mutationFn: async (activate: boolean) => {
      if (!idToken) throw new Error("Not authenticated");
      let targetWorkflowId = savedWorkflowId ?? workflowId ?? null;

      if (!targetWorkflowId) {
        if (!draft) throw new Error("No workflow draft available to save");
        const created = await createWorkflow({
          firebaseIdToken: idToken,
          name: draft.name,
          description: draft.description ?? undefined,
          steps,
          trigger,
        });
        targetWorkflowId = created.workflowId;
        setSavedWorkflowId(created.workflowId);
      } else {
        await saveWorkflow({
          firebaseIdToken: idToken,
          workflowId: targetWorkflowId,
          name: workflowDetail?.name ?? draft?.name ?? "Workflow draft",
          description: workflowDetail?.description ?? draft?.description ?? undefined,
          steps,
          trigger,
        });
      }

      if (activate) {
        await updateWorkflowStatus({
          firebaseIdToken: idToken,
          workflowId: targetWorkflowId,
          status: "active",
        });
      }
      return targetWorkflowId;
    },
    onSuccess: (targetWorkflowId, activate) => {
      queryClient.invalidateQueries({ queryKey: gideonQueryKeys.workflows(idToken) });
      queryClient.invalidateQueries({ queryKey: gideonQueryKeys.workflow(idToken, targetWorkflowId) });
      setIsSaved(true);
      setErrorMsg(null);
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save workflow");
    },
  });

  if (workflowId && isError) {
    return (
      <div className="flex h-[300px] flex-col items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/5 text-destructive p-6 text-center">
        <p className="text-sm font-medium mb-2">Failed to load workflow draft.</p>
        <p className="text-xs opacity-80">{error instanceof Error ? error.message : "Authentication expired or network error."}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => window.location.reload()}>Refresh Page</Button>
      </div>
    );
  }

  if (workflowId && (isLoading || !workflowDetail)) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-2xl border border-border bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground/50" />
      </div>
    );
  }

  // Interactive editing callbacks
  const handleAddStep = (type: WorkflowStep["type"]) => {
    const newStep: WorkflowStep = {
      id: crypto.randomUUID(),
      type,
      name: "New step", // Simplification; user can rename
      config: {},
      order: steps.length,
    };
    setSteps((prev) => [...prev, newStep]);
    setIsSaved(false);
  };

  const handleStepConfigChange = (stepId: string, field: string, value: unknown) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, config: { ...s.config, [field]: value } } : s)),
    );
    setIsSaved(false);
  };

  const handleStepNameChange = (stepId: string, name: string) => {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, name } : s)));
    setIsSaved(false);
  };

  const handleStepTypeChange = (stepId: string, type: WorkflowStep["type"]) => {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, type, config: {} } : s)));
    setIsSaved(false);
  };

  const handleStepDelete = (stepId: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
    setIsSaved(false);
  };

  const handleStepMove = (stepId: string, direction: "up" | "down") => {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === stepId);
      if (idx < 0) return prev;
      if (direction === "up" && idx === 0) return prev;
      if (direction === "down" && idx === prev.length - 1) return prev;
      const next = [...prev];
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
    setIsSaved(false);
  };

  const handleStepsReorder = (orderedIds: string[]) => {
    setSteps((prev) => {
      const map = new Map(prev.map((s) => [s.id, s]));
      return orderedIds.map((id) => map.get(id)!).filter(Boolean);
    });
    setIsSaved(false);
  };

  return (
    <div className="space-y-3">
      {draft && !savedWorkflowId ? (
        <div className="rounded-2xl border border-blue-200/70 bg-blue-50/70 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
            Unsaved workflow draft
          </p>
          <h3 className="mt-1 text-[15px] font-semibold text-foreground">{draft.name}</h3>
          {draft.description ? (
            <p className="mt-1 text-[13px] leading-6 text-muted-foreground">{draft.description}</p>
          ) : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-blue-100 bg-white/70 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700/70">
                Schedule
              </p>
              <p className="mt-1 text-[12px] font-medium text-foreground">{describeDraftSchedule(draft.trigger)}</p>
            </div>
            <div className="rounded-xl border border-blue-100 bg-white/70 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700/70">
                Delivery
              </p>
              <p className="mt-1 text-[12px] font-medium text-foreground">
                {describeDelivery(draft.deliveryIntent).label}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {describeDelivery(draft.deliveryIntent).helper}
              </p>
            </div>
          </div>
          {draft.validationIssues?.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] text-amber-700">
              {draft.validationIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <WorkflowCanvasView
        steps={steps}
        trigger={trigger}
        triggerType={String(trigger.type ?? "manual")}
        agentOptions={agentOptions}
        runDetail={null}
        onAddStep={handleAddStep}
        onTriggerChange={(t) => {
          setTrigger(t);
          setIsSaved(false);
        }}
        onStepConfigChange={handleStepConfigChange}
        onStepNameChange={handleStepNameChange}
        onStepTypeChange={handleStepTypeChange}
        onStepDelete={handleStepDelete}
        onStepMove={handleStepMove}
        onStepsReorder={handleStepsReorder}
      />
      
      <div className="flex flex-col rounded-xl border border-border bg-background p-3 shadow-sm">
        {errorMsg && (
          <div className="mb-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            {errorMsg}
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isSaved ? (
              <>
                <CheckCircle2 className="size-4 text-green-500" />
                <p className="text-sm font-medium text-green-600">
                  {saveMutation.variables ? "Workflow active" : "Workflow saved"}
                </p>
              </>
            ) : (
              <>
                <Save className="size-4 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">Draft mode</p>
                <p className="text-sm text-muted-foreground">Review and activate when ready.</p>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={isSaved || saveMutation.isPending}
              onClick={() => saveMutation.mutate(false)}
            >
              {saveMutation.isPending && !saveMutation.variables ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : null}
              Save Draft
            </Button>
            <Button
              size="sm"
              disabled={isSaved || saveMutation.isPending}
              onClick={() => saveMutation.mutate(true)}
            >
              {saveMutation.isPending && saveMutation.variables ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : null}
              Activate Workflow
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
