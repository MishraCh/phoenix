import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../components/ui/ToastProvider", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

import { IdleView } from "../components/app-shell/command-center/IdleView";
import { FollowUpComposer } from "../components/app-shell/command-center/FollowUpComposer";
import { emptyDashboardSummary } from "../services/dashboard";

describe("Command center composer behavior", () => {
  it("shows an agent picker in the idle composer for first-turn agent selection", () => {
    render(
      <IdleView
        command=""
        onCommandChange={vi.fn()}
        selectedMode={null}
        selectedAgentId={null}
        availableAgents={[
          {
            id: "sales",
            name: "Sales Assistant",
            type: "sales",
            description: "Revenue and pipeline help",
            status: "active",
          },
        ]}
        activeIntegrationContext={null}
        onClearIntegrationContext={vi.fn()}
        onSelectMode={vi.fn()}
        onSelectAgent={vi.fn()}
        onSubmit={vi.fn()}
        summary={emptyDashboardSummary}
        loadingSummary={false}
        summaryError={null}
        setupProgress={72}
        onRefreshSummary={vi.fn()}
        recentSessions={[]}
        onContinueSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onRenameSession={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /any agent/i })).toBeInTheDocument();
  });

  it("keeps the follow-up composer utility trigger available", () => {
    const { container } = render(
      <FollowUpComposer
        selectedMode={null}
        selectedAgentId={null}
        activeIntegrationContext={null}
        onClearIntegrationContext={vi.fn()}
        availableAgents={[]}
        isRunning={false}
        onSelectMode={vi.fn()}
        onSelectAgent={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const quickActionsButton = container.querySelector("button");
    expect(quickActionsButton).toBeTruthy();
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "placeholder",
      "Ask a follow-up, or type /search, /extract, /workflow...",
    );
  });
});
