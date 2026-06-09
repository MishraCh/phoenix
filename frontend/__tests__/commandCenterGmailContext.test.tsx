import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";

import { writeActiveIntegrationContext } from "../lib/activeIntegrationContext";
import { RunningStatusProvider } from "../components/app-shell/RunningStatusProvider";

const submitCommandMock = vi.fn();

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ idToken: "token_123" }),
}));

vi.mock("../hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    me: { defaultWorkspaceId: "ws_test" },
    workspaces: [{ id: "ws_test", name: "Workspace" }],
  }),
}));

vi.mock("../components/ui/ToastProvider", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

vi.mock("../hooks/useWorkspaceStream", () => ({
  useWorkspaceStream: vi.fn(),
}));

vi.mock("../hooks/useGideonQueries", () => ({
  gideonQueryKeys: { commandSessions: () => ["commandSessions", "token_123"] },
  useAgentsQuery: () => ({ data: { agents: [] } }),
  useCommandSessionsQuery: () => ({ data: { sessions: [] } }),
  useDashboardSummaryQuery: () => ({ data: { pendingApprovals: 0, activeWorkflowRuns: 0, activeAgents: 0, latestArtifacts: [] }, isLoading: false, error: null, refetch: vi.fn() }),
  useOnboardingQuery: () => ({ data: { onboarding: null } }),
  useWorkspaceDetailQuery: () => ({
    data: { profile: { companyName: "Test Workspace" } },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../services/dashboard", () => ({
  emptyDashboardSummary: { pendingApprovals: 0, activeWorkflowRuns: 0, activeAgents: 0, latestArtifacts: [] },
}));

vi.mock("../services/agents", () => ({
  fallbackAgents: [],
}));

vi.mock("../services/command", () => ({
  createLocalCommandPreview: vi.fn(),
  submitCommand: (...args: unknown[]) => submitCommandMock(...args),
}));

vi.mock("../services/commandSessions", () => ({
  backendMessagesToSessionMessages: vi.fn(),
  fetchCommandSession: vi.fn(),
}));

vi.mock("../components/ui/PageErrorBoundary", () => ({
  PageErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../components/app-shell/command-center/IdleView", () => ({
  IdleView: ({ onSubmit }: { onSubmit: (query: string, mode: "auto", agentId: string | null) => void }) => (
    <button type="button" onClick={() => onSubmit("Summarize my current workspace setup", "auto", null)}>
      Run command
    </button>
  ),
}));

vi.mock("../components/app-shell/command-center/SessionView", () => ({
  SessionView: () => <div>Session view</div>,
}));

import { CommandCenterPage } from "../components/app-shell/CommandCenterPage";

describe("CommandCenterPage integration context handoff", () => {
  it("passes the selected Gmail context bundle into command submission", async () => {
    submitCommandMock.mockResolvedValue({
      answer: "Using the selected Gmail thread.",
      agentRunId: "run_1",
      creditsCharged: 1,
      sessionId: "session_1",
      proposedActions: [],
      artifactDrafts: [],
      sources: [],
      missingContext: [],
      result: null,
      createdArtifact: null,
      createdApproval: null,
      createdWorkflow: null,
    });
    writeActiveIntegrationContext({
      provider: "gmail",
      itemId: "thread_1",
      title: "Board update",
      subtitle: "founder@example.com, board@example.com",
      contextBundleId: "ctx_gmail_thread_1",
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <RunningStatusProvider>
          <CommandCenterPage />
        </RunningStatusProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run command" }));

    await waitFor(() =>
      expect(submitCommandMock).toHaveBeenCalledWith(
        expect.objectContaining({
          contextBundleId: "ctx_gmail_thread_1",
          command: "Summarize my current workspace setup",
        }),
      ),
    );
  });

  it("passes the selected HubSpot context bundle into command submission", async () => {
    submitCommandMock.mockResolvedValue({
      answer: "Using the selected HubSpot record.",
      agentRunId: "run_2",
      creditsCharged: 1,
      sessionId: "session_2",
      proposedActions: [],
      artifactDrafts: [],
      sources: [],
      missingContext: [],
      result: null,
      createdArtifact: null,
      createdApproval: null,
      createdWorkflow: null,
    });
    writeActiveIntegrationContext({
      provider: "hubspot",
      itemId: "deal_42",
      title: "Acme Renewal",
      subtitle: "deals",
      contextBundleId: "ctx_hubspot_deal_42",
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <RunningStatusProvider>
          <CommandCenterPage />
        </RunningStatusProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run command" }));

    await waitFor(() =>
      expect(submitCommandMock).toHaveBeenCalledWith(
        expect.objectContaining({
          contextBundleId: "ctx_hubspot_deal_42",
          command: "Summarize my current workspace setup",
        }),
      ),
    );
  });
});
