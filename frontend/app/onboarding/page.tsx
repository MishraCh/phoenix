import { AuthGate } from "@/components/auth/AuthGate";
import { WorkspaceProvider } from "@/components/app-shell/WorkspaceProvider";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";

export default function OnboardingPage() {
  return (
    <AuthGate>
      <WorkspaceProvider>
        <OnboardingFlow />
      </WorkspaceProvider>
    </AuthGate>
  );
}
