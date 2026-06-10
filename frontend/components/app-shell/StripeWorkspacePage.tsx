"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CreditCard, KeyRound, Loader2, RefreshCw, ShieldCheck, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { IntegrationLogo } from "@/components/ui/IntegrationLogo";
import { StatusPill } from "@/components/ui/StatusPill";
import { useToast } from "@/components/ui/ToastProvider";
import { useAuth } from "@/hooks/useAuth";
import { getFriendlyErrorMessage } from "@/lib/product";
import {
  connectStripeWithKey,
  disconnectIntegration,
  fetchIntegrationDetail,
  fetchStripeOverview,
  type StripeOverview,
} from "@/services/integrations";

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function StripeWorkspacePage() {
  const { idToken } = useAuth();
  const { pushToast } = useToast();

  const [connected, setConnected] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<StripeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    if (!idToken) return;
    setLoading(true);
    try {
      const detail = await fetchIntegrationDetail(idToken, "stripe");
      const isConnected = detail.status === "connected" || detail.status === "syncing";
      setConnected(isConnected);
      if (isConnected) {
        setOverview(await fetchStripeOverview(idToken));
      }
    } catch {
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, [idToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleConnect() {
    if (!idToken || !apiKey.trim()) return;
    setConnecting(true);
    try {
      await connectStripeWithKey(idToken, apiKey.trim());
      pushToast({ title: "Stripe connected", description: "Revenue insights and payment links are now unlocked.", tone: "success" });
      setApiKey("");
      await load();
    } catch (error) {
      pushToast({
        title: "Connection failed",
        description: getFriendlyErrorMessage(error, "Stripe rejected that key."),
        tone: "error",
      });
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!idToken) return;
    try {
      await disconnectIntegration(idToken, "stripe");
      pushToast({ title: "Stripe disconnected", description: "The API key was removed.", tone: "success" });
      setConnected(false);
      setOverview(null);
    } catch (error) {
      pushToast({ title: "Disconnect failed", description: getFriendlyErrorMessage(error, "Try again."), tone: "error" });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/integrations/stripe" className="text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-5" />
          </Link>
          <div className="flex size-12 items-center justify-center rounded-2xl bg-[#635BFF] shadow-md">
            <IntegrationLogo providerId="stripe" fallbackIcon={CreditCard} className="size-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Stripe</h1>
            <p className="text-sm text-muted-foreground">Revenue, customers, and payments — agent-queryable.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={connected ? "connected" : "disconnected"} />
          {connected ? (
            <>
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => void load()} disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              </Button>
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => void handleDisconnect()}>
                <Unplug className="mr-1.5 size-4" />
                Disconnect
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {loading && connected === null ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading Stripe workspace…
        </div>
      ) : !connected ? (
        /* Connect form */
        <Card>
          <CardContent className="mx-auto max-w-lg space-y-4 p-8 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#635BFF]/10">
              <KeyRound className="size-6 text-[#635BFF]" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Connect Stripe with an API key</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Paste a <span className="font-medium text-foreground">restricted test-mode key</span> (rk_test_…) from the
              Stripe dashboard. It's stored encrypted and only used server-side.
            </p>
            <div className="flex gap-2">
              <Input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="rk_test_…"
                className="h-10 flex-1 font-mono text-sm"
              />
              <Button onClick={() => void handleConnect()} disabled={connecting || !apiKey.trim()} className="h-10 px-5">
                {connecting ? <Loader2 className="size-4 animate-spin" /> : "Connect"}
              </Button>
            </div>
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              Payment links and any money movement always require your approval.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Revenue snapshot */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">Gross volume · 30d</p>
                <p className="mt-2 text-3xl font-semibold text-foreground">
                  {overview ? formatMoney(overview.revenue.grossVolume30d, overview.revenue.currency) : "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">Payments · 30d</p>
                <p className="mt-2 text-3xl font-semibold text-foreground">{overview?.revenue.paymentsCount30d ?? "—"}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">Active subscriptions</p>
                <p className="mt-2 text-3xl font-semibold text-foreground">{overview?.revenue.activeSubscriptions ?? "—"}</p>
              </CardContent>
            </Card>
          </div>

          {/* Lists */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-5">
                <p className="mb-3 text-sm font-semibold text-foreground">Recent customers</p>
                {overview?.customers.length ? (
                  <div className="divide-y divide-border/40">
                    {overview.customers.map((customer) => (
                      <div key={customer.id} className="flex items-center justify-between py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{customer.name ?? customer.email ?? customer.id}</p>
                          {customer.name && customer.email ? (
                            <p className="truncate text-xs text-muted-foreground">{customer.email}</p>
                          ) : null}
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">{formatDate(customer.created)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">No customers yet.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="mb-3 text-sm font-semibold text-foreground">Recent payments</p>
                {overview?.payments.length ? (
                  <div className="divide-y divide-border/40">
                    {overview.payments.map((payment) => (
                      <div key={payment.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {formatMoney(payment.amount, payment.currency)}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {payment.description ?? payment.customerEmail ?? payment.id}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              payment.status === "succeeded"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {payment.status}
                          </span>
                          <span className="text-xs text-muted-foreground">{formatDate(payment.created)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">No payments yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Agent hint */}
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <p className="text-sm font-semibold text-foreground">Ask Gideon about your revenue</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try “How's my revenue this month?” or “Create a $99 payment link for a consulting session.”
                </p>
              </div>
              <Button asChild size="sm" className="rounded-full">
                <Link href="/command-center">Open Command Center</Link>
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
