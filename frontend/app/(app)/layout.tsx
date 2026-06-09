import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/AppShell";
import { RunningStatusProvider } from "@/components/app-shell/RunningStatusProvider";
import { SseProvider } from "@/components/app-shell/SseProvider";
import { WorkspaceProvider } from "@/components/app-shell/WorkspaceProvider";
import { AuthGate } from "@/components/auth/AuthGate";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";

type AppLayoutProps = {
  children: ReactNode;
};

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <AuthGate>
      <WorkspaceProvider>
        <SseProvider>
          <RunningStatusProvider>
            <OnboardingGate>
              <AppShell>{children}</AppShell>
            </OnboardingGate>
          </RunningStatusProvider>
        </SseProvider>
      </WorkspaceProvider>
    </AuthGate>
  );
}
