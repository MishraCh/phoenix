import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../hooks/useGideonQueries", () => ({
  useApprovalDetailQuery: () => ({
    data: null,
    isLoading: false,
  }),
}));

import { MessagePanel } from "../components/app-shell/command-center/MessagePanel";
import type { SessionMessage } from "../components/app-shell/command-center/types";

describe("Command center approval card", () => {
  it("renders an inline approve action for created approvals", () => {
    const onApproveApproval = vi.fn();
    const message: SessionMessage = {
      id: "msg_1",
      assistantMessageId: "assistant_1",
      userQuery: "send it to sharad@xoidlabs.com",
      mode: "auto",
      agentId: null,
      agentName: null,
      status: "completed",
      statusCopy: "Response ready.",
      starred: false,
      savedItemId: null,
      response: {
        answer: "Approval created.",
        agentRunId: "run_1",
        creditsCharged: 1,
        sessionId: "session_1",
        proposedActions: [],
        artifactDrafts: [],
        sources: [],
        missingContext: [],
        resultType: "answer",
        result: {
          kind: "answer",
          summary: "Approval created.",
          highlights: [],
          sections: [],
        },
        createdArtifact: null,
        createdApproval: {
          approvalId: "approval_1",
          label: "Send Gmail email: Exciting Investment Opportunity with Gideon",
          riskLevel: "medium",
          requiresApproval: true,
          status: "pending",
        },
        createdWorkflow: null,
      },
    };

    render(
      <MessagePanel
        message={message}
        onOpenDetails={vi.fn()}
        onApproveApproval={onApproveApproval}
        onEditApproval={vi.fn()}
        onToggleStar={vi.fn()}
        onSaveResponse={vi.fn()}
        onCreateArtifact={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: /approve & send/i });
    expect(button).toBeTruthy();
    fireEvent.click(button);
    expect(onApproveApproval).toHaveBeenCalledWith("msg_1", "approval_1");
  });
});
