"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BellRing, Lock, Palette, Pencil, Receipt, Shield, Wallet,
  User, Building2, Users, CreditCard, Bell, Bot, GitBranch, ShieldCheck, Brain, Sparkles, MessageSquare,
} from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/ToastProvider";
import { useAuth } from "@/hooks/useAuth";
import { gideonQueryKeys, useWorkspaceDetailQuery, useChannelCommandSessionsQuery } from "@/hooks/useGideonQueries";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getFriendlyErrorMessage } from "@/lib/product";
import { cn } from "@/lib/utils";
import { updateProfile } from "firebase/auth";
import { applyCoupon, createStripeCheckout, openStripePortal } from "@/services/billing";
import { updateWorkspaceSettings, type WorkspaceDetail, type WorkspaceListItem, type WorkspaceProfile } from "@/services/workspaces";

import { ProductHeader } from "./ProductHeader";
import { SummaryRow } from "./ProductPrimitives";

// ── Tab config ────────────────────────────────────────────────────────────────

const tabs = [
  "Profile",
  "Workspace",
  "Members & Roles",
  "Billing & Plan",
  "Notifications",
  "Agents",
  "Workflows",
  "Data & Privacy",
  "Security",
  "Appearance",
  "Channels",
] as const;

type SettingsTab = (typeof tabs)[number];

const tabGroups: { label: string; items: SettingsTab[] }[] = [
  { label: "Account", items: ["Profile"] },
  { label: "Workspace", items: ["Workspace", "Members & Roles", "Billing & Plan"] },
  { label: "Preferences", items: ["Notifications", "Agents", "Workflows", "Channels"] },
  { label: "Advanced", items: ["Data & Privacy", "Security", "Appearance"] },
];

const tabIcons: Record<SettingsTab, React.ElementType> = {
  "Profile": User,
  "Workspace": Building2,
  "Members & Roles": Users,
  "Billing & Plan": CreditCard,
  "Notifications": Bell,
  "Agents": Bot,
  "Workflows": GitBranch,
  "Data & Privacy": ShieldCheck,
  "Security": Lock,
  "Appearance": Palette,
  "Channels": MessageSquare,
};

// ── Shared section header ─────────────────────────────────────────────────────

function SectionHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="mb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</p>
      <h2 className="mt-1 text-base font-semibold text-foreground">{title}</h2>
      {description ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p> : null}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SettingsSnapshot = {
  me: ReturnType<typeof useWorkspace>["me"];
  workspace: WorkspaceDetail | null;
  workspaceRole: WorkspaceListItem["role"] | null;
};

// ── Main component ────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const { idToken, user } = useAuth();
  const { me, selectedWorkspace, refresh: refreshWorkspaces } = useWorkspace();
  const [activeTab, setActiveTab] = useState<SettingsTab>("Workspace");
  const [couponCode, setCouponCode] = useState("");

  // Deep link support: /settings?tab=billing (used by the topbar plan badge).
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("tab")?.toLowerCase();
    if (!slug) return;
    const slugToTab: Record<string, SettingsTab> = {
      billing: "Billing & Plan",
      profile: "Profile",
      workspace: "Workspace",
      members: "Members & Roles",
      notifications: "Notifications",
      agents: "Agents",
      workflows: "Workflows",
      security: "Security",
    };
    const tab = slugToTab[slug];
    if (tab) setActiveTab(tab);
  }, []);
  const [activeChannelView, setActiveChannelView] = useState<"list" | "history">("list");
  const [editName, setEditName] = useState(false);
  const [nameDraft, setNameDraft] = useState(user?.displayName ?? "");
  const [savingName, setSavingName] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Workspace identity profile state ──────────────────────────────────────
  const [profileDraft, setProfileDraft] = useState<WorkspaceProfile | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [togglingEmail, setTogglingEmail] = useState(false);

  const workspaceDetailQuery = useWorkspaceDetailQuery(selectedWorkspace?.id ?? null);
  const loading = Boolean(selectedWorkspace) && workspaceDetailQuery.isLoading && !workspaceDetailQuery.data;
  const error = actionError
    ?? (workspaceDetailQuery.error
      ? getFriendlyErrorMessage(workspaceDetailQuery.error, "We couldn't load workspace settings yet.")
      : null);
  const snapshot: SettingsSnapshot = {
    me,
    workspace: workspaceDetailQuery.data ?? null,
    workspaceRole: selectedWorkspace?.role ?? null,
  };

  const emailSessionsQuery = useChannelCommandSessionsQuery("email");
  const emailSessions = emailSessionsQuery.data?.sessions ?? [];

  // Initialize profileDraft from server data when it loads (only once)
  const serverProfile = workspaceDetailQuery.data?.profile ?? null;
  const effectiveProfile: WorkspaceProfile = profileDraft ?? serverProfile ?? {};

  const credits = useMemo(() => {
    if (!snapshot.workspace) return { used: 0, limit: 0 };
    return {
      used: snapshot.workspace.monthlyCreditsUsed,
      limit: snapshot.workspace.monthlyCreditsLimit,
    };
  }, [snapshot.workspace]);

  // ── Profile field count ───────────────────────────────────────────────────
  const profileFieldCount = useMemo(() => {
    const p = effectiveProfile;
    return [p.companyName, p.oneLiner, p.icp, p.differentiators, p.primaryCompetitors, p.industry, p.stage]
      .filter((v) => typeof v === "string" ? v.trim().length > 0 : Boolean(v)).length;
  }, [effectiveProfile]);

  const isProfileOwnerOrAdmin = ["owner", "admin"].includes(snapshot.workspaceRole ?? "");

  async function handleApplyCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!idToken || !couponCode.trim()) return;
    try {
      const result = await applyCoupon(idToken, couponCode.trim());
      pushToast({
        title: `Workspace upgraded to ${result.plan}`,
        description: `${result.creditsGranted} credits added to this workspace.`,
        tone: "success",
      });
      setCouponCode("");
      setActionError(null);
      await refreshWorkspaces();
      if (selectedWorkspace?.id) {
        await queryClient.invalidateQueries({
          queryKey: gideonQueryKeys.workspaceDetail(idToken, selectedWorkspace.id),
        });
      }
      await workspaceDetailQuery.refetch();
    } catch (nextError) {
      const message = getFriendlyErrorMessage(nextError, "We couldn't apply that code yet.");
      setActionError(message);
      pushToast({ title: "Code needs attention", description: message, tone: "error" });
    }
  }

  async function handleStripeCheckout(plan: "plus" | "pro") {
    if (!idToken) return;
    try {
      const { url } = await createStripeCheckout(idToken, plan);
      if (url) {
        window.location.assign(url);
      } else {
        pushToast({ title: "Checkout unavailable", description: "Stripe did not return a checkout URL.", tone: "error" });
      }
    } catch (nextError) {
      const message = getFriendlyErrorMessage(nextError, "Stripe checkout isn't configured yet.");
      pushToast({ title: "Checkout needs attention", description: message, tone: "error" });
    }
  }

  async function handleStripePortal() {
    if (!idToken) return;
    try {
      const { url } = await openStripePortal(idToken);
      window.location.assign(url);
    } catch (nextError) {
      const message = getFriendlyErrorMessage(nextError, "Billing portal is unavailable.");
      pushToast({ title: "Portal needs attention", description: message, tone: "error" });
    }
  }

  async function handleSaveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !nameDraft.trim()) return;
    setSavingName(true);
    try {
      await updateProfile(user, { displayName: nameDraft.trim() });
      pushToast({ title: "Name updated", tone: "success" });
      setEditName(false);
    } catch {
      pushToast({ title: "Couldn't update name", description: "Try again in a moment.", tone: "error" });
    } finally {
      setSavingName(false);
    }
  }

  async function handleSaveProfile() {
    if (!idToken || !selectedWorkspace?.id) return;
    setSavingProfile(true);
    try {
      // Strip cleared ("") fields — the backend enum/string validators reject empty strings,
      // and omitting a key removes it since the profile map is replaced wholesale.
      const cleanedProfile = Object.fromEntries(
        Object.entries(effectiveProfile).filter(([, value]) => value !== "" && value !== undefined && value !== null),
      ) as WorkspaceProfile;
      await updateWorkspaceSettings(idToken, selectedWorkspace.id, { profile: cleanedProfile });
      pushToast({ title: "AI context saved", description: "Gideon will use this in all responses.", tone: "success" });
      setProfileDraft(null);
      await queryClient.invalidateQueries({
        queryKey: gideonQueryKeys.workspaceDetail(idToken, selectedWorkspace.id),
      });
      await workspaceDetailQuery.refetch();
    } catch (err) {
      pushToast({
        title: "Couldn't save AI context",
        description: getFriendlyErrorMessage(err, "Try again in a moment."),
        tone: "error",
      });
    } finally {
      setSavingProfile(false);
    }
  }

  function setProfile(field: keyof WorkspaceProfile, value: string) {
    setProfileDraft((prev) => ({ ...(prev ?? serverProfile ?? {}), [field]: value }));
  }

  async function handleToggleEmail(enabled: boolean) {
    if (!idToken || !selectedWorkspace?.id) return;
    setTogglingEmail(true);
    try {
      await updateWorkspaceSettings(idToken, selectedWorkspace.id, { 
        channelsConfig: { 
          emailEnabled: enabled, 
          whatsappEnabled: snapshot.workspace?.channelsConfig?.whatsappEnabled ?? false 
        } 
      });
      pushToast({ title: enabled ? "Email Assistant enabled" : "Email Assistant disabled", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.workspaceDetail(idToken, selectedWorkspace.id) });
      await workspaceDetailQuery.refetch();
    } catch (err) {
      pushToast({ title: "Couldn't update settings", description: getFriendlyErrorMessage(err), tone: "error" });
    } finally {
      setTogglingEmail(false);
    }
  }

  const visibleTabGroups = useMemo(() => {
    return tabGroups.map(group => ({
      ...group,
      items: group.items.filter(tab => {
        if (tab === "Channels" && snapshot.workspace?.plan === "free") return false;
        return true;
      })
    })).filter(group => group.items.length > 0);
  }, [snapshot.workspace?.plan]);

  function renderTab() {
    if (loading) return <LoadingState label="Loading settings…" rows={3} />;
    if (error) return <ErrorState message={error} onRetry={() => void workspaceDetailQuery.refetch()} />;
    if (!snapshot.workspace || !snapshot.me) {
      return (
        <EmptyState
          title="No workspace selected yet"
          description="Create or join a workspace before opening the full settings area."
        />
      );
    }

    // ── Profile ──────────────────────────────────────────────────────────────
    if (activeTab === "Profile") {
      return (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-5">
              <SectionHeader eyebrow="Profile" title="Display name" />
              {editName ? (
                <form onSubmit={handleSaveName} className="flex items-center gap-2">
                  <Input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    className="h-9 flex-1"
                    autoFocus
                  />
                  <Button size="sm" type="submit" disabled={savingName}>
                    {savingName ? "Saving…" : "Save"}
                  </Button>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setEditName(false)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">{snapshot.me.displayName ?? snapshot.me.email}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    onClick={() => { setNameDraft(snapshot.me?.displayName ?? ""); setEditName(true); }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </div>
              )}
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-3 py-2">
                <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{snapshot.me.email}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Email is managed by your sign-in provider.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <SectionHeader eyebrow="Access" title="Workspace role" />
              <div className="flex items-center gap-3">
                <StatusPill status={snapshot.workspaceRole ?? "member"} />
                <span className="text-sm text-muted-foreground">Your current access level in this workspace.</span>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    // ── Workspace ─────────────────────────────────────────────────────────────
    if (activeTab === "Workspace") {
      const pct = credits.limit > 0 ? Math.round((credits.used / credits.limit) * 100) : 0;
      const barColor = pct > 90 ? "bg-destructive/70" : pct > 70 ? "bg-[hsl(var(--badge-warning-text))]" : "bg-primary";

      const STAGE_OPTIONS: Array<{ value: WorkspaceProfile["stage"]; label: string }> = [
        { value: "idea", label: "Idea" },
        { value: "pre-revenue", label: "Pre-revenue" },
        { value: "early", label: "Early" },
        { value: "growth", label: "Growth" },
        { value: "scale", label: "Scale" },
      ];

      const profileHasChanges = profileDraft !== null;

      return (
        <div className="space-y-4">
          {/* ── AI context / identity card ─────────────────────────────────── */}
          <Card className="border-primary/20 bg-gradient-to-br from-primary/[0.03] to-transparent">
            <CardContent className="p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
                    <Brain className="size-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">AI context</p>
                    <p className="text-xs text-muted-foreground">What Gideon knows about your business</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    profileFieldCount === 7
                      ? "bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]"
                      : profileFieldCount > 2
                        ? "bg-[hsl(var(--badge-warning-bg,220_13%_91%))] text-[hsl(var(--badge-warning-text))]"
                        : "bg-muted text-muted-foreground"
                  }`}>
                    {profileFieldCount}/7 fields
                  </span>
                </div>
              </div>

              {profileFieldCount === 0 && !profileHasChanges && (
                <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-primary/15 bg-primary/5 px-3.5 py-3">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <p className="text-xs text-muted-foreground">
                    Fill in these fields and Gideon will automatically personalize battlecards, outreach drafts,
                    and all expert analysis to your specific business — no more generic responses.
                  </p>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Company name</label>
                  <Input
                    value={effectiveProfile.companyName ?? ""}
                    onChange={(e) => setProfile("companyName", e.target.value)}
                    placeholder="e.g. BuildFast"
                    disabled={!isProfileOwnerOrAdmin}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Industry</label>
                  <Input
                    value={effectiveProfile.industry ?? ""}
                    onChange={(e) => setProfile("industry", e.target.value)}
                    placeholder="e.g. Construction Tech"
                    disabled={!isProfileOwnerOrAdmin}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">One-liner</label>
                  <Input
                    value={effectiveProfile.oneLiner ?? ""}
                    onChange={(e) => setProfile("oneLiner", e.target.value)}
                    placeholder="e.g. B2B SaaS for construction project management"
                    disabled={!isProfileOwnerOrAdmin}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">Ideal customer (ICP)</label>
                  <Textarea
                    value={effectiveProfile.icp ?? ""}
                    onChange={(e) => setProfile("icp", e.target.value)}
                    placeholder="e.g. VP of Operations at mid-market contractors, 50-500 employees, $10M-$100M ARR"
                    disabled={!isProfileOwnerOrAdmin}
                    rows={2}
                    className="resize-none text-sm"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">Key differentiators</label>
                  <Textarea
                    value={effectiveProfile.differentiators ?? ""}
                    onChange={(e) => setProfile("differentiators", e.target.value)}
                    placeholder="e.g. 3x faster onboarding than Procore, 40% cheaper than Buildertrend, best mobile UX"
                    disabled={!isProfileOwnerOrAdmin}
                    rows={2}
                    className="resize-none text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Primary competitors</label>
                  <Input
                    value={effectiveProfile.primaryCompetitors ?? ""}
                    onChange={(e) => setProfile("primaryCompetitors", e.target.value)}
                    placeholder="e.g. Procore, Buildertrend"
                    disabled={!isProfileOwnerOrAdmin}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Company stage</label>
                  <div className="flex flex-wrap gap-1.5">
                    {STAGE_OPTIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        disabled={!isProfileOwnerOrAdmin}
                        onClick={() => setProfile("stage", value === effectiveProfile.stage ? "" : (value ?? ""))}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                          effectiveProfile.stage === value
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        } disabled:pointer-events-none disabled:opacity-50`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">Additional context</label>
                  <Textarea
                    value={effectiveProfile.additionalContext ?? ""}
                    onChange={(e) => setProfile("additionalContext", e.target.value)}
                    placeholder="Anything else Gideon should always know — pricing model, geographic focus, compliance constraints, deal size, sales motion…"
                    disabled={!isProfileOwnerOrAdmin}
                    rows={3}
                    className="resize-none text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Response style</label>
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      { value: "concise", label: "Concise" },
                      { value: "balanced", label: "Balanced" },
                      { value: "detailed", label: "Detailed" },
                    ] as const).map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        disabled={!isProfileOwnerOrAdmin}
                        onClick={() => setProfile("responseTone", value === effectiveProfile.responseTone ? "" : value)}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                          effectiveProfile.responseTone === value
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        } disabled:pointer-events-none disabled:opacity-50`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">How long and deep Gideon's answers are by default. Asking for a different style in a message always overrides this.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Style notes</label>
                  <Textarea
                    value={effectiveProfile.responseStyleNotes ?? ""}
                    onChange={(e) => setProfile("responseStyleNotes", e.target.value)}
                    placeholder="E.g. bullet points over prose, no fluff, always cite sources inline, executive-summary first…"
                    disabled={!isProfileOwnerOrAdmin}
                    rows={2}
                    className="resize-none text-sm"
                  />
                </div>
              </div>

              {isProfileOwnerOrAdmin && (
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/50 pt-4">
                  <p className="text-xs text-muted-foreground">
                    Gideon uses this in every command, battlecard, and expert analysis.
                  </p>
                  <Button
                    size="sm"
                    onClick={() => void handleSaveProfile()}
                    disabled={savingProfile || !profileHasChanges}
                    className="shrink-0 gap-1.5"
                  >
                    {savingProfile ? "Saving…" : "Save context"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Workspace summary cards ─────────────────────────────────────── */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Workspace</p>
                <h3 className="mt-3 text-xl font-semibold">{snapshot.workspace.name}</h3>
                <div className="mt-2 flex items-center gap-2">
                  <StatusPill status={snapshot.workspace.plan} />
                  <span className="text-sm text-muted-foreground">
                    · {snapshot.workspace.members.length} member{snapshot.workspace.members.length === 1 ? "" : "s"}
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Monthly usage</p>
                <div className="mt-3 flex items-end justify-between gap-2">
                  <span className="text-2xl font-semibold font-mono-data">{credits.used.toLocaleString()}</span>
                  <span className="mb-0.5 text-sm text-muted-foreground">/ {credits.limit.toLocaleString()}</span>
                </div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border/60">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{pct}% used · resets each billing cycle</p>
              </CardContent>
            </Card>
          </div>
        </div>
      );
    }

    // ── Members & Roles ───────────────────────────────────────────────────────
    if (activeTab === "Members & Roles") {
      return (
        <div className="space-y-3">
          <p className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {snapshot.workspace.members.length} member{snapshot.workspace.members.length === 1 ? "" : "s"}
          </p>
          {snapshot.workspace.members.map((member) => (
            <Card key={member.userId}>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-sm font-semibold text-muted-foreground">
                  {member.userId.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{member.userId}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Workspace member</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusPill status={member.role} />
                  <StatusPill status={member.status} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      );
    }

    // ── Billing & Plan ────────────────────────────────────────────────────────
    if (activeTab === "Billing & Plan") {
      const pct = Math.round((credits.used / Math.max(credits.limit, 1)) * 100);
      const ringColor = pct > 90 ? "#CC2222" : pct > 70 ? "#F5A623" : "hsl(221 73% 41%)";
      const circumference = 2 * Math.PI * 36;
      const dashOffset = circumference * (1 - pct / 100);

      return (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardContent className="p-5">
              <SectionHeader eyebrow="Billing" title="Current plan" />
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill status={snapshot.workspace.plan} />
              </div>
              <div className="mt-5 flex items-center gap-6">
                <svg width="88" height="88" viewBox="0 0 88 88" className="shrink-0 -rotate-90">
                  <circle cx="44" cy="44" r="36" fill="none" stroke="hsl(214 40% 93%)" strokeWidth="8" />
                  <circle
                    cx="44" cy="44" r="36" fill="none"
                    stroke={ringColor} strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                    style={{ transition: "stroke-dashoffset 0.6s ease" }}
                  />
                </svg>
                <div>
                  <p className="text-3xl font-semibold font-mono-data" style={{ color: ringColor }}>{pct}%</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{credits.used}</span> of {credits.limit} credits
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Resets at the start of each billing cycle.</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardContent className="p-5">
                <SectionHeader eyebrow="Upgrade" title="Subscribe with Stripe" />
                <p className="text-xs text-muted-foreground">
                  Secure checkout via Stripe. Promo codes can be entered at checkout; manage or cancel anytime.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-border/60 p-3">
                    <p className="text-sm font-semibold">Plus — $29/mo</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">3 seats · 1,500 credits · 3 integrations</p>
                    <Button
                      className="mt-2 w-full"
                      size="sm"
                      variant={snapshot.workspace.plan === "plus" ? "outline" : "default"}
                      onClick={() => void handleStripeCheckout("plus")}
                    >
                      {snapshot.workspace.plan === "plus" ? "Current plan" : "Upgrade to Plus"}
                    </Button>
                  </div>
                  <div className="rounded-xl border border-border/60 p-3">
                    <p className="text-sm font-semibold">Pro — $99/mo</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">10 seats · 7,500 credits · 8 integrations</p>
                    <Button
                      className="mt-2 w-full"
                      size="sm"
                      variant={snapshot.workspace.plan === "pro" ? "outline" : "default"}
                      onClick={() => void handleStripeCheckout("pro")}
                    >
                      {snapshot.workspace.plan === "pro" ? "Current plan" : "Upgrade to Pro"}
                    </Button>
                  </div>
                </div>
                <Button variant="ghost" className="mt-2 w-full text-xs" onClick={() => void handleStripePortal()}>
                  Manage billing (Stripe customer portal)
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <SectionHeader eyebrow="Upgrade" title="Apply workspace code" />
                <form onSubmit={handleApplyCoupon} className="space-y-3">
                  <div>
                    <label className="text-sm font-medium" htmlFor="coupon-code">Code</label>
                    <Input
                      id="coupon-code"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value)}
                      placeholder="PLUS2026"
                      className="mt-1.5 h-9"
                    />
                  </div>
                  <Button type="submit" className="w-full">Apply code</Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      );
    }

    // ── Notifications ─────────────────────────────────────────────────────────
    if (activeTab === "Notifications") {
      const notifRows = [
        { label: "Approval requests", desc: "Notify when an action is waiting for your review." },
        { label: "Workflow completions", desc: "Notify when a workflow finishes running." },
        { label: "Workflow failures", desc: "Notify when a workflow step fails." },
        { label: "New artifacts", desc: "Notify when Gideon saves a new document or report." },
        { label: "Memory updates", desc: "Notify when workspace memory is refreshed." },
      ];
      return (
        <Card>
          <CardContent className="p-5">
            <SectionHeader
              eyebrow="Notifications"
              title="Notification preferences"
              description="Choose how Gideon keeps you informed about approvals, completed work, and important changes."
            />
            <div className="divide-y divide-border/50">
              {notifRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 py-3.5">
                  <div>
                    <p className="text-sm font-medium">{row.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{row.desc}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/40 p-0.5">
                    <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">In-app</span>
                    <span className="px-2.5 py-1 text-xs font-medium text-muted-foreground">Email</span>
                    <span className="px-2.5 py-1 text-xs font-medium text-muted-foreground">Off</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Full notification configuration available in a future release.</p>
          </CardContent>
        </Card>
      );
    }

    // ── Agents ────────────────────────────────────────────────────────────────
    if (activeTab === "Agents") {
      const agentRows = [
        { name: "Executive", desc: "Planning, decision support, and high-level research.", active: true },
        { name: "Research", desc: "Deep web research, source analysis, and synthesis.", active: true },
        { name: "Outreach", desc: "Email drafting, follow-ups, and CRM context.", active: false },
        { name: "Operations", desc: "Workflow execution, task management, and scheduling.", active: false },
      ];
      return (
        <Card>
          <CardContent className="p-5">
            <SectionHeader
              eyebrow="Agents"
              title="Assistant access"
              description="Manage which assistants are available to this workspace."
            />
            <div className="divide-y divide-border/50">
              {agentRows.map((agent) => (
                <div key={agent.name} className="flex items-center justify-between gap-4 py-3.5">
                  <div>
                    <p className="text-sm font-medium">{agent.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{agent.desc}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${agent.active ? "bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]" : "bg-muted text-muted-foreground"}`}>
                    {agent.active ? "Active" : "Inactive"}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Contact your admin to enable or disable assistants.</p>
          </CardContent>
        </Card>
      );
    }

    // ── Workflows ─────────────────────────────────────────────────────────────
    if (activeTab === "Workflows") {
      return (
        <Card>
          <CardContent className="p-5">
            <SectionHeader
              eyebrow="Workflows"
              title="Workflow defaults"
              description="Set baseline guardrails and expectations for newly created workflows."
            />
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium">Default approval requirement</p>
                <p className="mt-0.5 text-xs text-muted-foreground">New workflows will require approval before running external actions.</p>
                <div className="mt-2.5 flex w-fit items-center gap-1 rounded-full border border-border bg-muted/40 p-0.5">
                  <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">Always require</span>
                  <span className="px-2.5 py-1 text-xs font-medium text-muted-foreground">High risk only</span>
                  <span className="px-2.5 py-1 text-xs font-medium text-muted-foreground">Never</span>
                </div>
              </div>
              <div className="border-t border-border/50 pt-5">
                <p className="text-sm font-medium">Default run schedule</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Workflows without an explicit trigger will default to manual runs.</p>
                <div className="mt-2.5 flex w-fit items-center gap-1 rounded-full border border-border bg-muted/40 p-0.5">
                  <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">Manual</span>
                  <span className="px-2.5 py-1 text-xs font-medium text-muted-foreground">Scheduled</span>
                </div>
              </div>
            </div>
            <p className="mt-5 text-xs text-muted-foreground">Full workflow guardrail configuration coming in a future release.</p>
          </CardContent>
        </Card>
      );
    }

    // ── Data & Privacy ────────────────────────────────────────────────────────
    if (activeTab === "Data & Privacy") {
      const dataRows = [
        { label: "Session history", desc: "Gideon compresses past sessions for memory continuity.", status: "Active" },
        { label: "Workspace memory", desc: "Learned facts, preferences, and contacts stored per workspace.", status: "Active" },
        { label: "Integration context", desc: "Indexed records from connected tools (Google Workspace, etc.).", status: "Active" },
        { label: "Artifact storage", desc: "Documents and reports saved to Library.", status: "Active" },
      ];
      return (
        <Card>
          <CardContent className="p-5">
            <SectionHeader
              eyebrow="Privacy"
              title="Data and privacy"
              description="Review how workspace information is stored and which sources are available to Gideon."
            />
            <div className="divide-y divide-border/50">
              {dataRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 py-3.5">
                  <div>
                    <p className="text-sm font-medium">{row.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{row.desc}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[hsl(var(--badge-success-bg))] px-2.5 py-0.5 text-xs font-medium text-[hsl(var(--badge-success-text))]">
                    {row.status}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Data retention and deletion controls coming in a future release.</p>
          </CardContent>
        </Card>
      );
    }

    // ── Security ──────────────────────────────────────────────────────────────
    if (activeTab === "Security") {
      return (
        <Card>
          <CardContent className="p-5">
            <SectionHeader
              eyebrow="Security"
              title="Security settings"
              description="Review sign-in and workspace access settings for your team."
            />
            <div className="divide-y divide-border/50">
              <div className="flex items-center justify-between gap-4 py-3.5">
                <div>
                  <p className="text-sm font-medium">Sign-in method</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Google OAuth via Firebase Authentication.</p>
                </div>
                <span className="shrink-0 rounded-full bg-[hsl(var(--badge-running-bg))] px-2.5 py-0.5 text-xs font-medium text-primary">
                  Google OAuth
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <div>
                  <p className="text-sm font-medium">Session management</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Sessions expire after inactivity. Managed by your sign-in provider.</p>
                </div>
                <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Provider-managed</span>
              </div>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <div>
                  <p className="text-sm font-medium">Workspace access</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Managed via member roles. Owners can invite and remove members.</p>
                </div>
                <span className="shrink-0 rounded-full bg-[hsl(var(--badge-success-bg))] px-2.5 py-0.5 text-xs font-medium text-[hsl(var(--badge-success-text))]">Role-based</span>
              </div>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">SSO, audit logs, and 2FA enforcement are available on Pro and Enterprise plans.</p>
          </CardContent>
        </Card>
      );
    }

    // ── Appearance ────────────────────────────────────────────────────────────
    if (activeTab === "Appearance") {
      return (
        <Card>
          <CardContent className="p-5">
            <SectionHeader eyebrow="Appearance" title="Interface theme" />
            <p className="text-sm leading-6 text-muted-foreground">
              This workspace currently uses the light interface.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <StatusPill status="light only" />
            </div>
          </CardContent>
        </Card>
      );
    }

    // ── Channels ──────────────────────────────────────────────────────────────
    if (activeTab === "Channels") {
      const emailEnabled = snapshot.workspace?.channelsConfig?.emailEnabled ?? false;
      const isFree = snapshot.workspace?.plan === "free";

      if (activeChannelView === "history") {
        return (
          <div className="space-y-4">
            <Button variant="ghost" size="sm" onClick={() => setActiveChannelView("list")} className="mb-2 -ml-3 text-muted-foreground hover:text-foreground">
              &larr; Back to Channels
            </Button>
            <Card>
              <CardContent className="p-0">
                <div className="p-5 border-b border-border/50">
                  <SectionHeader
                    eyebrow="History"
                    title="Email execution log"
                    description="Recent commands executed by Gideon headlessly via email."
                  />
                </div>
                {emailSessionsQuery.isLoading ? (
                  <div className="p-8"><LoadingState label="Loading sessions..." rows={2} /></div>
                ) : emailSessions.length === 0 ? (
                  <div className="p-8">
                    <EmptyState title="No email sessions yet" description="Emails sent to Gideon will appear here." />
                  </div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {emailSessions.map(session => (
                      <div key={session.id} className="p-4 hover:bg-muted/30 transition-colors">
                        <p className="text-sm font-medium line-clamp-1">{session.title}</p>
                        <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                          <span>{new Date(session.createdAt).toLocaleDateString()}</span>
                          <span>•</span>
                          <span className="capitalize">{session.status}</span>
                          <span>•</span>
                          <span>{session.turnCount} turns</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        );
      }

      return (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-5">
              <SectionHeader
                eyebrow="Channels"
                title="Integrations & Channels"
                description="Connect Gideon to your external platforms to create a truly unified workspace."
              />
              <div className="divide-y divide-border/50">
                <div className="flex items-start justify-between gap-4 py-4">
                  <div>
                    <p className="text-sm font-medium">Email Integration</p>
                    <p className="mt-0.5 max-w-[28rem] text-xs text-muted-foreground leading-relaxed">
                      Turn any email into an action item. Forward threads to Gideon and get intelligent summaries, drafted replies, and automated CRM updates.
                      Available only on Plus and Pro plans.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={emailEnabled}
                    disabled={isFree || togglingEmail}
                    onClick={() => void handleToggleEmail(!emailEnabled)}
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                      emailEnabled ? "bg-primary" : "bg-muted"
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow ring-0 transition duration-200 ease-in-out",
                        emailEnabled ? "translate-x-5" : "translate-x-0"
                      )}
                    />
                  </button>
                </div>
                
                {emailEnabled && !isFree && (
                  <div className="bg-muted/30 px-4 py-3 border-t border-border/50 flex justify-end">
                    <Button variant="secondary" size="sm" onClick={() => setActiveChannelView("history")}>
                      View Email History
                    </Button>
                  </div>
                )}
                
                <div className="flex items-start justify-between gap-4 py-4 opacity-60">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium">
                      WhatsApp Intelligence
                      <span className="rounded-full bg-[hsl(var(--badge-warning-bg))] px-2 py-0.5 text-[10px] font-semibold text-[hsl(var(--badge-warning-text))] uppercase tracking-wider">
                        Coming Soon
                      </span>
                    </p>
                    <p className="mt-0.5 max-w-[28rem] text-xs text-muted-foreground leading-relaxed">
                      Deploy Gideon to your pocket. Ask questions, log meeting notes via voice, and pull CRM records directly from WhatsApp.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={false}
                    disabled
                    className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed items-center rounded-full border-2 border-transparent bg-muted transition-colors duration-200 ease-in-out"
                  >
                    <span
                      aria-hidden="true"
                      className="pointer-events-none inline-block h-5 w-5 transform translate-x-0 rounded-full bg-background shadow ring-0 transition duration-200 ease-in-out"
                    />
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return null;
  }

  return (
    <section className="space-y-6">
      <ProductHeader
        eyebrow="Settings"
        title="Workspace settings"
        description="Manage your profile, team, plan, notifications, and workspace preferences."
        meta={
          <SummaryRow
            className="md:grid-cols-3 xl:grid-cols-3"
            items={[
              {
                label: "Workspace plan",
                value: snapshot.workspace?.plan?.toUpperCase() ?? "FREE",
                detail: "Current plan and workspace operating tier.",
                icon: CreditCard,
                tone: snapshot.workspace?.plan && snapshot.workspace.plan !== "free" ? "success" : "neutral",
              },
              {
                label: "Credits used",
                value: `${credits.used}/${credits.limit}`,
                detail: "Monthly Gideon usage against the workspace allowance.",
                icon: Wallet,
                tone: credits.used > 0 ? "primary" : "neutral",
              },
              {
                label: "Members",
                value: snapshot.workspace?.members.length ?? 0,
                detail: "People currently active in this workspace.",
                icon: Users,
                tone: (snapshot.workspace?.members.length ?? 0) > 1 ? "success" : "neutral",
              },
            ]}
          />
        }
      />

      <div className="grid gap-5 xl:grid-cols-[15rem_1fr]">

        {/* ── Tab sidebar ─────────────────────────────────────────────────── */}
        <div className="h-fit rounded-container border border-border/60 bg-[hsl(220_25%_97%)] p-2">
          {visibleTabGroups.map((group, gi) => (
            <div key={group.label} className={gi > 0 ? "mt-3" : ""}>
              <p className="mb-1 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
                {group.label}
              </p>
              {group.items.map((tab) => {
                const TabIcon = tabIcons[tab];
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors duration-150 ${
                      isActive
                        ? "bg-white font-semibold text-primary shadow-sm ring-1 ring-border/60"
                        : "font-medium text-muted-foreground hover:bg-white/60 hover:text-foreground"
                    }`}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
                    )}
                    <TabIcon className={`size-3.5 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                    {tab}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        <div>{renderTab()}</div>
      </div>
    </section>
  );
}
