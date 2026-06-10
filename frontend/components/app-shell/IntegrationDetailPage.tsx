"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckSquare,
  CreditCard,
  Database,
  LockKeyhole,
  Mail,
  Plug,
  RefreshCw,
  Reply,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { ErrorState } from "@/components/ui/ErrorState";
import { IntegrationLogo } from "@/components/ui/IntegrationLogo";
import { LoadingState } from "@/components/ui/LoadingState";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/StatusPill";
import { useToast } from "@/components/ui/ToastProvider";
import { useAuth } from "@/hooks/useAuth";
import { useIntegrationDetailQuery } from "@/hooks/useGideonQueries";
import { getFriendlyErrorMessage } from "@/lib/product";
import { fallbackIntegrations, type IntegrationDetail } from "@/services/integrations";
import { connectIntegration, connectStripeWithKey, disconnectIntegration } from "@/services/integrations";
import { Input } from "@/components/ui/input";
import { useState } from "react";

type IntegrationDetailPageProps = {
  provider: string;
};

const INTEGRATION_META: Record<
  string,
  {
    label: string;
    icon: LucideIcon;
    description: string;
    workspacePath: string;
    theme: string;
    accent: string;
    iconBg?: string;
    iconText?: string;
    capabilities: Array<{ title: string; desc: string; icon: LucideIcon }>;
  }
> = {
  gmail: {
    label: "Gmail",
    icon: Mail,
    description: "Turn your inbox into an actionable workspace. Read threads, draft replies, and summarize long chains instantly.",
    workspacePath: "/integrations/gmail/workspace",
    theme: "from-blue-500/20 via-sky-500/5 to-transparent",
    accent: "text-blue-600 bg-blue-500/10 border-blue-500/20",
    iconBg: "bg-[#4285F4]",
    iconText: "text-white",
    capabilities: [
      { title: "Smart Summaries", desc: "Condense long email threads into bullet points instantly.", icon: Sparkles },
      { title: "AI Drafting", desc: "Draft replies that match your tone of voice.", icon: Reply },
      { title: "Workflow Automation", desc: "Extract action items and push them to your task manager.", icon: Workflow },
    ],
  },
  google: {
    label: "Gmail",
    icon: Mail,
    description: "Turn your inbox into an actionable workspace. Read threads, draft replies, and summarize long chains instantly.",
    workspacePath: "/integrations/gmail/workspace",
    theme: "from-blue-500/20 via-sky-500/5 to-transparent",
    accent: "text-blue-600 bg-blue-500/10 border-blue-500/20",
    iconBg: "bg-[#4285F4]",
    iconText: "text-white",
    capabilities: [
      { title: "Smart Summaries", desc: "Condense long email threads into bullet points instantly.", icon: Sparkles },
      { title: "AI Drafting", desc: "Draft replies that match your tone of voice.", icon: Reply },
      { title: "Workflow Automation", desc: "Extract action items and push them to your task manager.", icon: Workflow },
    ],
  },
  stripe: {
    label: "Stripe",
    icon: CreditCard,
    description: "Connect Stripe so Gideon can answer revenue questions, surface customers and payments, and create payment links with your approval.",
    workspacePath: "/integrations/stripe/workspace",
    theme: "from-indigo-500/20 via-violet-500/5 to-transparent",
    accent: "text-indigo-600 bg-indigo-500/10 border-indigo-500/20",
    iconBg: "bg-[#635BFF]",
    iconText: "text-white",
    capabilities: [
      { title: "Revenue Insights", desc: "Ask about volume, payments, and subscriptions in plain language.", icon: Sparkles },
      { title: "Payments Workspace", desc: "Customers, payments, and subscriptions at a glance.", icon: Database },
      { title: "Approval-Gated Links", desc: "Payment links are only created after you approve.", icon: ShieldCheck },
    ],
  },
  hubspot: {
    label: "HubSpot CRM",
    icon: Building2,
    description: "Bring your CRM data into Gideon. Browse contacts, edit deals, and log notes without context switching.",
    workspacePath: "/integrations/hubspot/workspace",
    theme: "from-orange-500/20 via-amber-500/5 to-transparent",
    accent: "text-orange-600 bg-orange-500/10 border-orange-500/20",
    iconBg: "bg-[#FF7A59]",
    iconText: "text-white",
    capabilities: [
      { title: "Native CRM Views", desc: "Browse contacts, companies, and deals directly in the shell.", icon: Database },
      { title: "Effortless Updates", desc: "Add notes and mark tasks as done with zero friction.", icon: CheckSquare },
      { title: "Approval-Gated", desc: "Changes to your CRM are always paused for your approval.", icon: ShieldCheck },
    ],
  },
};

export function IntegrationDetailPage({ provider }: IntegrationDetailPageProps) {
  const normalizedProvider = provider === "google" ? "gmail" : provider;
  const logoProvider = provider === "gmail" ? "google" : normalizedProvider;
  const isFrontendEnabled = normalizedProvider === "gmail" || normalizedProvider === "hubspot" || normalizedProvider === "stripe";
  const isComingSoon = normalizedProvider === "gmail";
  const { idToken } = useAuth();
  const { pushToast } = useToast();
  const [stripeKey, setStripeKey] = useState("");
  const [stripeConnecting, setStripeConnecting] = useState(false);
  const integrationQuery = useIntegrationDetailQuery(normalizedProvider);
  const fallbackIntegration = fallbackIntegrations.find((item) => item.provider === normalizedProvider) ?? fallbackIntegrations[0];
  const integration = (integrationQuery.data ??
    ({ ...fallbackIntegration, items: [] } as IntegrationDetail)) as IntegrationDetail;
  const loading = integrationQuery.isLoading && !integrationQuery.data;

  const isNotConnected = integrationQuery.error instanceof Error && (
    integrationQuery.error.message.includes("404") ||
    integrationQuery.error.message.toLowerCase().includes("not connected")
  );
  const error = integrationQuery.error && !isNotConnected
    ? getFriendlyErrorMessage(integrationQuery.error, "We couldn't load this integration.")
    : null;

  const meta = INTEGRATION_META[provider] ?? INTEGRATION_META[normalizedProvider] ?? null;
  const ProviderIcon = meta?.icon ?? Plug;
  const isConnected = !isNotConnected && (integration.status === "connected" || integration.status === "syncing");

  async function handleConnect() {
    if (!idToken) return;
    try {
      const result = await connectIntegration(idToken, normalizedProvider);
      window.location.href = result.authUrl;
    } catch (err) {
      pushToast({ title: "Connection failed", description: getFriendlyErrorMessage(err, "Could not start OAuth."), tone: "error" });
    }
  }

  async function handleDisconnect() {
    if (!idToken) return;
    try {
      await disconnectIntegration(idToken, normalizedProvider);
      pushToast({ title: "Disconnected", description: "Integration removed safely.", tone: "success" });
      void integrationQuery.refetch();
    } catch (err) {
      pushToast({ title: "Disconnect failed", description: getFriendlyErrorMessage(err, "Could not disconnect."), tone: "error" });
    }
  }

  if (loading) return <LoadingState label="Loading integration..." rows={3} />;
  if (error) return <ErrorState message={error} onRetry={() => void integrationQuery.refetch()} />;

  return (
    <div className="relative min-h-[calc(100vh-4rem)]">
      {/* Background glow */}
      <div className={`absolute inset-x-0 top-0 h-[500px] bg-gradient-to-b ${meta?.theme ?? "from-slate-200/50 to-transparent"} opacity-60 -z-10 pointer-events-none`} />

      {/* Breadcrumb - Absolute Top Left */}
      <div className="absolute left-6 top-6 flex items-center gap-2 text-[13px] text-muted-foreground/80 z-10">
        <Link href="/integrations" className="transition-colors hover:text-foreground">Integrations</Link>
        <span className="text-border/60">/</span>
        <span className="font-medium text-foreground">{meta?.label ?? provider}</span>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-16">
        
        {/* Hero Section */}
        <div className="flex flex-col items-center text-center">
          <div className={`relative flex size-24 items-center justify-center rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] ${meta?.iconBg ?? "bg-slate-100"}`}>
            <IntegrationLogo providerId={logoProvider} fallbackIcon={ProviderIcon} className={`size-12 ${meta?.iconText ?? "text-foreground"}`} />
          </div>
          
          <h1 className="mt-8 text-4xl font-semibold tracking-tight text-foreground">{meta?.label ?? provider}</h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">{meta?.description ?? "Manage this integration."}</p>
          
          <div className="mt-8 flex flex-col items-center gap-4">
            <StatusPill status={isNotConnected ? "disconnected" : integration.status} />
            
            {isConnected ? (
              <div className="flex items-center gap-3 mt-4">
                {isFrontendEnabled && meta?.workspacePath ? (
                  <Button asChild size="lg" className="rounded-full shadow-md">
                    <Link href={meta.workspacePath}>
                      Open Workspace
                      <ArrowRight className="ml-2 size-4" />
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : isComingSoon ? (
              <div className="mt-4 flex flex-col items-center gap-2">
                <span className="rounded-full border border-border/60 bg-secondary/60 px-5 py-2 text-sm font-semibold text-muted-foreground">
                  Coming soon
                </span>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Gmail is on the way. Connect HubSpot or Stripe in the meantime.
                </p>
              </div>
            ) : normalizedProvider === "stripe" ? (
              <div className="mt-4 w-full max-w-md space-y-2">
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={stripeKey}
                    onChange={(event) => setStripeKey(event.target.value)}
                    placeholder="rk_test_… or sk_test_…"
                    className="h-11 flex-1 rounded-full bg-white px-4 font-mono text-sm shadow-sm"
                  />
                  <Button
                    size="lg"
                    className="rounded-full px-6 shadow-md"
                    disabled={!idToken || stripeConnecting || !stripeKey.trim()}
                    onClick={async () => {
                      if (!idToken) return;
                      setStripeConnecting(true);
                      try {
                        await connectStripeWithKey(idToken, stripeKey.trim());
                        pushToast({ title: "Stripe connected", description: "Revenue insights and payment links unlocked.", tone: "success" });
                        setStripeKey("");
                        void integrationQuery.refetch();
                      } catch (err) {
                        pushToast({ title: "Connection failed", description: getFriendlyErrorMessage(err, "Stripe rejected that key."), tone: "error" });
                      } finally {
                        setStripeConnecting(false);
                      }
                    }}
                  >
                    {stripeConnecting ? "Connecting…" : "Connect"}
                  </Button>
                </div>
                <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <LockKeyhole className="size-3.5" />
                  Paste a test-mode restricted key from your Stripe dashboard — stored encrypted, used server-side only.
                </p>
              </div>
            ) : (
              <Button size="lg" className="mt-4 rounded-full shadow-md px-8" onClick={() => void handleConnect()} disabled={!idToken}>
                Connect {meta?.label ?? provider}
              </Button>
            )}
          </div>
        </div>

        {/* Capabilities Grid */}
        {meta?.capabilities && meta.capabilities.length > 0 && (
          <div className="mt-20">
            <h3 className="text-center text-sm font-semibold uppercase tracking-widest text-muted-foreground/70 mb-8">What it unlocks</h3>
            <div className="grid gap-6 md:grid-cols-3">
              {meta.capabilities.map((cap) => {
                const Icon = cap.icon;
                return (
                  <div key={cap.title} className="rounded-3xl border border-border/50 bg-white/50 p-6 shadow-sm backdrop-blur-sm transition-all hover:bg-white/80">
                    <div className={`mb-4 flex size-10 items-center justify-center rounded-2xl border ${meta.accent}`}>
                      <Icon className="size-5" />
                    </div>
                    <h4 className="text-base font-semibold text-foreground">{cap.title}</h4>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{cap.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Settings Block */}
        <div className="mt-16 mx-auto max-w-2xl rounded-3xl border border-border/50 bg-white/60 p-8 shadow-sm backdrop-blur-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-foreground">Connection Settings</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {isConnected ? `Connected as ${integration.accountEmail}` : "No account currently connected."}
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              {isConnected ? (
                <>
                  <Button variant="outline" size="sm" className="rounded-full" onClick={() => void integrationQuery.refetch()}>
                    <RefreshCw className="mr-2 size-3.5" />
                    Refresh
                  </Button>
                  <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground hover:text-destructive" onClick={() => void handleDisconnect()} disabled={!idToken}>
                    Disconnect
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-6 border-t border-border/50 pt-6">
            <div className="flex items-start gap-3 text-sm text-muted-foreground">
              <LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary/60" />
              <p className="leading-relaxed">
                Gideon securely authenticates via OAuth. Access tokens remain heavily encrypted on our servers and are never exposed in the browser.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
