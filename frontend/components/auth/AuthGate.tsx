"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/hooks/useAuth";
import { FullscreenLoader } from "@/components/ui/FullscreenLoader";

type AuthGateProps = {
  children: ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { authError, loading, user } = useAuth();

  useEffect(() => {
    if (!loading && !authError && !user) {
      router.replace(`/auth?next=${encodeURIComponent(pathname)}`);
    }
  }, [authError, loading, pathname, router, user]);

  if (loading) {
    return (
      <FullscreenLoader
        title="Checking session"
        description="Restoring your workspace access…"
        steps={["Verifying identity…", "Restoring access…", "Almost there…"]}
      />
    );
  }

  if (authError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md rounded-3xl border border-border bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold text-primary">Sign-in needs attention</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{authError}</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return children;
}
