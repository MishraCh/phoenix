"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useOnboardingQuery } from "@/hooks/useGideonQueries";
import { useWorkspace } from "@/hooks/useWorkspace";
import { FullscreenLoader } from "@/components/ui/FullscreenLoader";
import { Button } from "@/components/ui/button";
import { canEnterAppFromOnboarding } from "@/services/onboarding";

type OnboardingGateProps = {
  children: ReactNode;
};

export function OnboardingGate({ children }: OnboardingGateProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { loading, me, workspaces } = useWorkspace();
  const workspaceId = me?.defaultWorkspaceId ?? workspaces[0]?.id ?? null;
  const onboardingQuery = useOnboardingQuery(workspaceId);
  const onboarding = onboardingQuery.data?.onboarding ?? null;
  const onboardingLoading = Boolean(workspaceId) && onboardingQuery.isLoading && !onboardingQuery.data;

  useEffect(() => {
    if (loading || onboardingLoading || pathname === "/onboarding" || !workspaceId) {
      return;
    }

    if (!canEnterAppFromOnboarding(onboarding)) {
      router.replace("/onboarding");
    }
  }, [loading, onboarding, onboardingLoading, pathname, router, workspaceId]);

  if (loading || onboardingLoading) {
    return (
      <FullscreenLoader
        title="Preparing your workspace"
        description="Loading your setup progress…"
        steps={["Loading workspace…", "Checking setup…", "Fetching progress…", "Almost ready…"]}
      />
    );
  }

  if (workspaceId && onboardingQuery.error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md rounded-3xl border border-border bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold text-primary">Setup needs attention</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            We couldn't check your setup progress right now.
          </p>
          <Button className="mt-5 rounded-2xl" onClick={() => void onboardingQuery.refetch()}>
            Try again
          </Button>
        </div>
      </main>
    );
  }

  if (workspaceId && !canEnterAppFromOnboarding(onboarding)) {
    return null;
  }

  return children;
}
