"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { ArrowRight, Check } from "lucide-react";

import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { FullscreenLoader } from "@/components/ui/FullscreenLoader";
import { gideonQueryKeys, useOnboardingQuery } from "@/hooks/useGideonQueries";
import { getFriendlyErrorMessage } from "@/lib/product";
import {
  fetchOnboardingProgress,
  isOnboardingDeferred,
  saveOnboardingProgress,
  type OnboardingStateResponse,
} from "@/services/onboarding";
import { updateWorkspaceSettings } from "@/services/workspaces";
import { Button } from "@/components/ui/button";

// ── Config ────────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 5;

const STEP_META = [
  {
    title: "Good to have you.",
    subtitle: "Your AI chief of staff for what matters most.",
  },
  {
    title: "Tell us about yourself.",
    subtitle: "Help Gideon understand who it's working with.",
  },
  {
    title: "About your business.",
    subtitle: "Gideon uses this to personalize every response.",
  },
  {
    title: "What do you want to focus on?",
    subtitle: "Gideon will surface these priorities from day one.",
  },
  {
    title: "You're all set.",
    subtitle: "Gideon is ready to help.",
  },
];

const ROLE_OPTIONS = ["Founder / CEO", "Operator / COO", "Chief of Staff", "Sales Leader", "Other"];
const TEAM_SIZE_OPTIONS = ["Just me", "2–10", "11–50", "50+"];
const INDUSTRY_OPTIONS = ["Technology", "Healthcare", "Finance", "E-commerce", "Real Estate", "Consulting", "Other"];
const AGENT_OPTIONS = ["Executive", "Sales", "Research", "Operations", "Customer", "Recruiting"];

// ── Types ─────────────────────────────────────────────────────────────────────

type OnboardingState = {
  currentStep: number;
  completed: boolean;
  sampleWorkspaceEnabled: boolean;
  responses: Record<string, unknown>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const DRAFT_KEY_PREFIX = "gideon:onboarding:draft";

function getDraftKey(workspaceId: string) {
  return `${DRAFT_KEY_PREFIX}:${workspaceId}`;
}

function loadDraft(workspaceId: string): OnboardingState | null {
  try {
    const raw = window.localStorage.getItem(getDraftKey(workspaceId));
    if (!raw) return null;
    return JSON.parse(raw) as OnboardingState;
  } catch {
    window.localStorage.removeItem(getDraftKey(workspaceId));
    return null;
  }
}

function writeDraft(workspaceId: string, state: OnboardingState) {
  window.localStorage.setItem(getDraftKey(workspaceId), JSON.stringify(state));
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((i) => typeof i === "string");
}

function buildInitialState(onboarding: OnboardingStateResponse | null | undefined): OnboardingState {
  return {
    currentStep: onboarding?.currentStep ?? 0,
    completed: onboarding?.completed ?? false,
    sampleWorkspaceEnabled: onboarding?.sampleWorkspaceEnabled ?? true,
    responses: onboarding?.responses ?? {},
  };
}

// ── Animation ─────────────────────────────────────────────────────────────────

const EASE = [0.22, 1, 0.36, 1] as const;

const slideVariants = {
  enter: (dir: number) => ({ x: dir * 24, opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { duration: 0.32, ease: EASE } },
  exit: (dir: number) => ({ x: dir * -24, opacity: 0, transition: { duration: 0.2, ease: EASE } }),
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } },
};

// ── Progress dots ─────────────────────────────────────────────────────────────

function StepDots({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: TOTAL_STEPS - 1 }).map((_, i) => (
        <motion.div
          key={i}
          className="rounded-full"
          animate={{
            width: i === current - 1 ? 20 : 6,
            height: 6,
            backgroundColor:
              i < current - 1
                ? "hsl(221,73%,60%)"
                : i === current - 1
                  ? "hsl(221,73%,41%)"
                  : "hsl(214,35%,89%)",
          }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

// ── Pill option ───────────────────────────────────────────────────────────────

function Pill({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-xl border px-3.5 py-1.5 text-[13px] font-medium transition-all duration-150",
        selected
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
      ].join(" ")}
    >
      {selected && <span className="mr-1.5">✓</span>}
      {label}
    </button>
  );
}

// ── Field ─────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <motion.div variants={fadeUp} className="space-y-2 flex flex-col items-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground text-center">
        {label}
      </p>
      {children}
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function OnboardingFlow() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { idToken } = useAuth();
  const { loading: workspaceLoading, me, workspaces } = useWorkspace();
  const workspaceId = me?.defaultWorkspaceId ?? workspaces[0]?.id ?? null;
  const onboardingQuery = useOnboardingQuery(workspaceId);

  const [state, setState] = useState<OnboardingState>({
    currentStep: 0,
    completed: false,
    sampleWorkspaceEnabled: true,
    responses: {},
  });
  const [direction, setDirection] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => { setHydrated(false); }, [workspaceId]);

  useEffect(() => {
    if (workspaceLoading || !workspaceId || hydrated) return;
    const serverState = buildInitialState(onboardingQuery.data?.onboarding);
    const draft = loadDraft(workspaceId);
    setState({
      currentStep: draft?.currentStep ?? serverState.currentStep,
      completed: serverState.completed,
      sampleWorkspaceEnabled: draft?.sampleWorkspaceEnabled ?? serverState.sampleWorkspaceEnabled,
      responses: { ...serverState.responses, ...(draft?.responses ?? {}) },
    });
    setHydrated(true);
  }, [hydrated, onboardingQuery.data?.onboarding, workspaceId, workspaceLoading]);

  useEffect(() => {
    if (!workspaceId || !hydrated) return;
    writeDraft(workspaceId, state);
  }, [hydrated, state, workspaceId]);

  useEffect(() => {
    if (
      onboardingQuery.data?.onboarding?.completed &&
      !isOnboardingDeferred(onboardingQuery.data.onboarding) &&
      !submitting
    ) {
      router.replace("/command-center");
    }
  }, [onboardingQuery.data?.onboarding, router, submitting]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function getString(key: string) {
    return typeof state.responses[key] === "string" ? String(state.responses[key]) : "";
  }

  function getList(key: string): string[] {
    return isStringArray(state.responses[key]) ? state.responses[key] : [];
  }

  function setResponse(key: string, value: string | string[]) {
    setError(null);
    setState((s) => ({ ...s, responses: { ...s.responses, [key]: value } }));
  }

  function toggleItem(key: string, value: string) {
    const list = getList(key);
    setResponse(key, list.includes(value) ? list.filter((i) => i !== value) : [...list, value]);
  }

  // ── API ──────────────────────────────────────────────────────────────────────

  async function persistState(nextState: OnboardingState) {
    if (!idToken || !workspaceId) throw new Error("Sign in before continuing setup.");
    const payload = await saveOnboardingProgress({
      workspaceId,
      firebaseIdToken: idToken,
      currentStep: nextState.currentStep,
      completed: nextState.completed,
      sampleWorkspaceEnabled: nextState.sampleWorkspaceEnabled,
      responses: nextState.responses,
    });
    queryClient.setQueryData(gideonQueryKeys.onboarding(idToken, workspaceId), payload);
    await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.dashboardSummary(idToken) });
    return payload.onboarding;
  }

  async function moveToStep(target: number, completed: boolean) {
    const nextResponses = { ...state.responses };
    delete nextResponses.onboardingDeferred;
    delete nextResponses.onboardingDeferredAt;

    const nextState: OnboardingState = {
      ...state,
      currentStep: Math.max(0, Math.min(TOTAL_STEPS - 1, target)),
      completed,
      responses: nextResponses,
    };

    setState(nextState);
    setSubmitting(true);

    try {
      const saved = await persistState(nextState);
      const synced: OnboardingState = {
        currentStep: saved.currentStep,
        completed: saved.completed,
        sampleWorkspaceEnabled: saved.sampleWorkspaceEnabled,
        responses: saved.responses,
      };
      setState(synced);
      if (workspaceId) writeDraft(workspaceId, synced);

      // On completion, save any business identity data collected in Step 2
      // to the workspace profile. Non-blocking \u2014 silently skipped if missing.
      if (saved.completed && idToken && workspaceId) {
        const r = nextState.responses;
        const profile = {
          companyName: typeof r.companyName === "string" ? r.companyName : undefined,
          oneLiner: typeof r.oneLiner === "string" ? r.oneLiner : undefined,
          icp: typeof r.icp === "string" ? r.icp : undefined,
          differentiators: typeof r.differentiators === "string" ? r.differentiators : undefined,
          primaryCompetitors: typeof r.primaryCompetitors === "string" ? r.primaryCompetitors : undefined,
          industry: typeof r.industry === "string" ? r.industry : undefined,
        };
        const hasAny = Object.values(profile).some((v) => v && String(v).trim());
        if (hasAny) {
          try {
            await updateWorkspaceSettings(idToken, workspaceId, { profile });
            await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.workspaces(idToken) });
          } catch {
            // Silent \u2014 user can complete this in Settings \u2192 Workspace
          }
        }
        router.replace("/command-center");
        return;
      }

      if (saved.completed) { router.replace("/command-center"); return; }
      setError(null);
    } catch (err) {
      setError(getFriendlyErrorMessage(err, "We couldn't save your setup progress."));
    } finally {
      setSubmitting(false);
    }
  }

  async function skipForNow() {
    const nextState: OnboardingState = {
      ...state,
      completed: false,
      responses: {
        ...state.responses,
        onboardingDeferred: true,
        onboardingDeferredAt: new Date().toISOString(),
      },
    };
    setState(nextState);
    setSubmitting(true);
    try {
      const saved = await persistState(nextState);
      const synced: OnboardingState = {
        currentStep: saved.currentStep,
        completed: saved.completed,
        sampleWorkspaceEnabled: saved.sampleWorkspaceEnabled,
        responses: saved.responses,
      };
      setState(synced);
      if (workspaceId) writeDraft(workspaceId, synced);
      router.replace("/command-center");
    } catch (err) {
      setError(getFriendlyErrorMessage(err, "We couldn't save your choice."));
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshFromBackend() {
    if (!idToken || !workspaceId) return;
    setSubmitting(true);
    try {
      const payload = await fetchOnboardingProgress(idToken, workspaceId);
      queryClient.setQueryData(gideonQueryKeys.onboarding(idToken, workspaceId), payload);
      setState(buildInitialState(payload.onboarding));
      setError(null);
    } catch (err) {
      setError(getFriendlyErrorMessage(err, "We couldn't reload setup progress."));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (workspaceLoading || !workspaceId || !hydrated) {
    return (
      <FullscreenLoader
        title="Preparing your workspace"
        description="Loading setup progress…"
        steps={["Loading workspace…", "Fetching setup progress…", "Almost ready…"]}
      />
    );
  }

  // ── Step content ─────────────────────────────────────────────────────────────

  const step = state.currentStep;
  const meta = STEP_META[step] ?? STEP_META[0]!;
  const isWelcome = step === 0;
  const isReady = step === TOTAL_STEPS - 1;

  const summaryRows = [
    { label: "Role", value: getString("role") },
    { label: "Team size", value: getString("teamSize") },
    { label: "Industry", value: getString("industry") },
    { label: "Company", value: getString("companyName") },
    { label: "What we do", value: getString("oneLiner").slice(0, 80) || null },
    { label: "Focus", value: getString("goals").slice(0, 80) || null },
    {
      label: "Assistants",
      value: getList("preferredAgents").length > 0 ? getList("preferredAgents").join(", ") : null,
    },
  ].filter((r): r is { label: string; value: string } => Boolean(r.value));

  function renderStep1() {
    return (
      <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
        <Field label="Your role">
          <div className="flex flex-wrap justify-center gap-2">
            {ROLE_OPTIONS.map((r) => (
              <Pill
                key={r}
                label={r}
                selected={getString("role") === r}
                onClick={() => setResponse("role", getString("role") === r ? "" : r)}
              />
            ))}
          </div>
        </Field>

        <Field label="Team size">
          <div className="flex flex-wrap justify-center gap-2">
            {TEAM_SIZE_OPTIONS.map((s) => (
              <Pill
                key={s}
                label={s}
                selected={getString("teamSize") === s}
                onClick={() => setResponse("teamSize", getString("teamSize") === s ? "" : s)}
              />
            ))}
          </div>
        </Field>

        <Field label="Industry">
          <div className="flex flex-wrap justify-center gap-2">
            {INDUSTRY_OPTIONS.map((i) => (
              <Pill
                key={i}
                label={i}
                selected={getString("industry") === i}
                onClick={() => setResponse("industry", getString("industry") === i ? "" : i)}
              />
            ))}
          </div>
        </Field>

        <Field label="Company or project">
          <input
            value={getString("companyName")}
            onChange={(e) => setResponse("companyName", e.target.value)}
            placeholder="Optional"
            className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
          />
        </Field>
      </motion.div>
    );
  }

  function renderStep2() {
    return (
      <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
        <Field label="What does your company do?">
          <input
            value={getString("oneLiner")}
            onChange={(e) => setResponse("oneLiner", e.target.value)}
            placeholder="e.g. B2B SaaS for construction project management"
            className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
          />
        </Field>

        <Field label="Ideal customer (ICP)">
          <textarea
            value={getString("icp")}
            onChange={(e) => setResponse("icp", e.target.value)}
            rows={2}
            placeholder="e.g. VP of Operations at mid-market contractors, 50–500 employees"
            className="w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
          />
        </Field>

        <Field label="Key differentiators">
          <textarea
            value={getString("differentiators")}
            onChange={(e) => setResponse("differentiators", e.target.value)}
            rows={2}
            placeholder="e.g. 3x faster onboarding, 40% cheaper than the market leader"
            className="w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
          />
        </Field>

        <Field label="Primary competitors">
          <input
            value={getString("primaryCompetitors")}
            onChange={(e) => setResponse("primaryCompetitors", e.target.value)}
            placeholder="e.g. Salesforce, HubSpot, Procore"
            className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
          />
        </Field>

        <p className="text-center text-[11px] text-muted-foreground/60">
          You can always update this in Settings → Workspace.
        </p>
      </motion.div>
    );
  }

  function renderStep3() {
    return (
      <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
        <Field label="What should Gideon help you focus on?">
          <textarea
            value={getString("goals")}
            onChange={(e) => setResponse("goals", e.target.value)}
            rows={3}
            placeholder="e.g. investor updates, hiring pipeline, sales follow-up, customer escalations…"
            className="w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
          />
        </Field>

        <Field label="Assistants to activate">
          <div className="flex flex-wrap justify-center gap-2">
            {AGENT_OPTIONS.map((a) => (
              <Pill
                key={a}
                label={a}
                selected={getList("preferredAgents").includes(a)}
                onClick={() => toggleItem("preferredAgents", a)}
              />
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground/60">
            All assistants are available — this helps Gideon prioritize your setup.
          </p>
        </Field>
      </motion.div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-50">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-100/50 via-white to-white" />
      {/* Premium animated orbs */}
      <motion.div
        className="pointer-events-none absolute -left-20 -top-20 size-[600px] rounded-full opacity-60 mix-blend-multiply"
        style={{
          background: "radial-gradient(circle, rgba(147,197,253,0.8), transparent 70%)",
          filter: "blur(90px)",
        }}
        animate={{ x: [0, 50, 0], y: [0, 30, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="pointer-events-none absolute -bottom-40 -right-20 size-[500px] rounded-full opacity-50 mix-blend-multiply"
        style={{
          background: "radial-gradient(circle, rgba(196,181,253,0.8), transparent 70%)",
          filter: "blur(80px)",
        }}
        animate={{ x: [0, -40, 0], y: [0, -50, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-12">
        {/* Logo + progress — hidden on welcome (hero has its own logo) */}
        {!isWelcome && (
          <motion.div
            className="mb-10 flex flex-col items-center gap-5"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            <Image src="/logo.svg" alt="Gideon" width={64} height={64} className="rounded-xl" priority />
            <StepDots current={step} />
          </motion.div>
        )}

        {/* Step panel */}
        <div className="w-full max-w-[640px]">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
            >
              {/* ── Welcome ───────────────────────────────────────────────── */}
              {isWelcome && (
                <motion.div
                  className="text-center"
                  variants={stagger}
                  initial="hidden"
                  animate="show"
                >
                  <motion.div
                    variants={fadeUp}
                    className="relative mx-auto mb-8 flex size-[104px] items-center justify-center"
                  >
                    <motion.div
                      className="absolute inset-0 rounded-2xl bg-primary/10"
                      animate={{ scale: [1, 1.18, 1], opacity: [0.6, 0, 0.6] }}
                      transition={{ duration: 2.8, repeat: Infinity, ease: "easeOut" }}
                    />
                    <motion.div
                      className="absolute inset-2 rounded-xl bg-primary/10"
                      animate={{ scale: [1, 1.12, 1], opacity: [0.7, 0, 0.7] }}
                      transition={{ duration: 2.8, repeat: Infinity, ease: "easeOut", delay: 0.3 }}
                    />
                    <Image src="/logo.svg" alt="Gideon" width={96} height={96} className="relative rounded-[18px] shadow-md" priority />
                  </motion.div>

                  <motion.h1
                    variants={fadeUp}
                    className="text-[2.4rem] font-semibold leading-tight tracking-tight text-foreground"
                  >
                    {meta.title}
                  </motion.h1>

                  <motion.p variants={fadeUp} className="mt-3 text-base text-muted-foreground">
                    {meta.subtitle}
                  </motion.p>

                  <motion.p variants={fadeUp} className="mt-1.5 text-sm text-muted-foreground/60">
                    Takes 2 minutes. Helps Gideon work the way you do.
                  </motion.p>

                  <motion.div variants={fadeUp} className="mt-10 flex flex-col items-center gap-3">
                    <Button
                      size="lg"
                      onClick={() => { setDirection(1); void moveToStep(1, false); }}
                      disabled={submitting}
                      className="gap-2 px-8"
                    >
                      Get started
                      <ArrowRight className="size-4" />
                    </Button>
                    <button
                      type="button"
                      onClick={() => void skipForNow()}
                      disabled={submitting}
                      className="text-sm text-muted-foreground/50 transition hover:text-muted-foreground disabled:opacity-40"
                    >
                      Skip for now
                    </button>
                  </motion.div>
                </motion.div>
              )}

              {/* ── Form steps ────────────────────────────────────────────── */}
              {!isWelcome && !isReady && (
                <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-panel)]">
                  <div className="px-7 pb-6 pt-7">
                    <motion.div variants={stagger} initial="hidden" animate="show" className="mb-6 space-y-1 text-center">
                      <motion.p
                        variants={fadeUp}
                        className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary/70"
                      >
                        Step {step} of {TOTAL_STEPS - 1}
                      </motion.p>
                      <motion.h2
                        variants={fadeUp}
                        className="text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground"
                      >
                        {meta.title}
                      </motion.h2>
                      <motion.p variants={fadeUp} className="text-sm text-muted-foreground">
                        {meta.subtitle}
                      </motion.p>
                    </motion.div>

                    {step === 1 ? renderStep1() : step === 2 ? renderStep2() : renderStep3()}
                  </div>

                  <div className="flex items-center justify-between border-t border-border bg-secondary/30 px-7 py-4">
                    <button
                      type="button"
                      onClick={() => { setDirection(-1); void moveToStep(step - 1, false); }}
                      disabled={submitting}
                      className="text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                    >
                      ← Back
                    </button>
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => void skipForNow()}
                        disabled={submitting}
                        className="text-sm text-muted-foreground/60 transition hover:text-muted-foreground disabled:opacity-40"
                      >
                        Skip for now
                      </button>
                      <Button
                        size="sm"
                        onClick={() => { setDirection(1); void moveToStep(step + 1, false); }}
                        disabled={submitting}
                        className="gap-1.5"
                      >
                        {submitting ? "Saving…" : "Continue"}
                        <ArrowRight className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Ready ─────────────────────────────────────────────────── */}
              {isReady && (
                <motion.div
                  className="text-center"
                  variants={stagger}
                  initial="hidden"
                  animate="show"
                >
                  <motion.div
                    variants={fadeUp}
                    className="relative mx-auto mb-8 flex size-[72px] items-center justify-center"
                  >
                    <motion.div
                      className="absolute inset-0 rounded-2xl bg-green-500/10"
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1.2, opacity: 0 }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
                    />
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.1, type: "spring", stiffness: 220, damping: 18 }}
                      className="flex size-[44px] items-center justify-center rounded-[14px] bg-green-500 shadow-md"
                    >
                      <Check className="size-5 text-white" />
                    </motion.div>
                  </motion.div>

                  <motion.h1
                    variants={fadeUp}
                    className="text-[2.4rem] font-semibold leading-tight tracking-tight text-foreground"
                  >
                    {meta.title}
                  </motion.h1>

                  <motion.p variants={fadeUp} className="mt-3 text-base text-muted-foreground">
                    {meta.subtitle}
                  </motion.p>

                  {summaryRows.length > 0 && (
                    <motion.div
                      variants={fadeUp}
                      className="mt-7 overflow-hidden rounded-2xl border border-border bg-card text-left shadow-[var(--shadow-card)]"
                    >
                      {summaryRows.map((row, i) => (
                        <div
                          key={row.label}
                          className={`flex items-start justify-between gap-6 px-5 py-3 ${
                            i < summaryRows.length - 1 ? "border-b border-border" : ""
                          }`}
                        >
                          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {row.label}
                          </span>
                          <span className="text-right text-sm text-foreground">{row.value}</span>
                        </div>
                      ))}
                    </motion.div>
                  )}

                  <motion.div variants={fadeUp} className="mt-7">
                    <Button
                      size="lg"
                      onClick={() => void moveToStep(TOTAL_STEPS - 1, true)}
                      disabled={submitting}
                      className="w-full gap-2"
                    >
                      {submitting ? "Saving…" : "Enter Command Center"}
                      <ArrowRight className="size-4" />
                    </Button>
                  </motion.div>

                  <motion.div variants={fadeUp}>
                    <button
                      type="button"
                      onClick={() => { setDirection(-1); void moveToStep(step - 1, false); }}
                      disabled={submitting}
                      className="mt-4 text-sm text-muted-foreground/60 transition hover:text-muted-foreground disabled:opacity-40"
                    >
                      ← Back
                    </button>
                  </motion.div>
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600"
              >
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => void refreshFromBackend()}
                  className="ml-4 text-xs underline underline-offset-2 hover:text-red-800"
                >
                  Retry
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
