import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const workspaceRefetch = vi.fn();
const threadRefetch = vi.fn();
const runIntegrationActionMock = vi.fn();

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ idToken: "token_123" }),
}));

vi.mock("../components/ui/ToastProvider", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

vi.mock("../hooks/useGideonQueries", () => ({
  useIntegrationWorkspaceQuery: () => ({
    data: {
      connection: {
        id: "gmail",
        provider: "gmail",
        status: "connected",
        accountEmail: "founder@example.com",
        watchStatus: "pending",
        fullResyncRequired: true,
        ownerOnly: true,
        access: "owner",
      },
      list: [
        {
          id: "thread_1",
          threadId: "thread_1",
          subject: "Investor update",
          snippet: "Quick update on fundraising",
          from: "advisor@example.com",
          lastMessageAt: "2026-05-15T09:30:00.000Z",
          unread: false,
        },
      ],
    },
    isLoading: false,
    error: null,
    isFetching: false,
    refetch: workspaceRefetch,
  }),
  useIntegrationItemQuery: () => ({
    data: {
      provider: "gmail",
      detail: {
        id: "thread_1",
        threadId: "thread_1",
        subject: "Investor update",
        snippet: "Quick update on fundraising",
        participants: ["founder@example.com", "advisor@example.com"],
        messages: [
          {
            id: "m1",
            from: "advisor@example.com",
            to: ["founder@example.com"],
            cc: [],
            subject: "Investor update",
            sentAt: "2026-05-15T09:30:00.000Z",
            snippet: "Quick update on fundraising",
            bodyText: "Here is the latest fundraising update.",
          },
        ],
      },
      sourceRefs: [],
      contextBundleId: "ctx_123",
      selectedContext: {
        provider: "gmail",
        itemId: "thread_1",
        itemType: "email_thread",
        title: "Investor update",
        summary: "Quick update",
        content: "Here is the latest fundraising update.",
      },
    },
    isLoading: false,
    error: null,
    refetch: threadRefetch,
  }),
  useGmailStyleProfileQuery: () => ({
    data: { profile: null },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("../services/integrations", () => ({
  syncIntegration: vi.fn(),
  runIntegrationAction: (...args: unknown[]) => runIntegrationActionMock(...args),
  analyzeGmailStyleProfile: vi.fn(),
  deleteGmailStyleProfile: vi.fn(),
}));

import { GmailWorkspacePageV2 } from "../components/app-shell/GmailWorkspacePageV2";

describe("GmailWorkspacePageV2", () => {
  it("renders the polished workspace with sync warning and selected thread detail", () => {
    render(<GmailWorkspacePageV2 />);

    expect(screen.getByText("Manual catch-up required")).toBeTruthy();
    expect(screen.getAllByText("Investor update").length).toBeGreaterThan(0);
    expect(screen.queryByText("Select a thread to read it here")).toBeNull();
    expect(screen.getByText(/May 15, 2026/i)).toBeTruthy();
  });

  it("lets the user compose a new outbound email and send it for approval from the workspace", async () => {
    runIntegrationActionMock.mockResolvedValue({
      approvalId: "approval_1",
      subject: "Pitch Gideon",
      body: "Hello Sharad",
      to: ["sharad@xoidlabs.com"],
      cc: [],
      sourceRefs: [],
    });

    render(<GmailWorkspacePageV2 />);

    fireEvent.click(screen.getByRole("button", { name: /compose/i }));
    fireEvent.change(screen.getByPlaceholderText(/name@example.com/i), {
      target: { value: "sharad@xoidlabs.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/subject line/i), {
      target: { value: "Pitch Gideon" },
    });
    fireEvent.change(screen.getByPlaceholderText(/write the email body here/i), {
      target: { value: "Hello Sharad" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send for approval/i }));

    await waitFor(() =>
      expect(runIntegrationActionMock).toHaveBeenCalledWith(
        "token_123",
        "gmail",
        "prepareSendApproval",
        expect.objectContaining({
          to: ["sharad@xoidlabs.com"],
          subject: "Pitch Gideon",
          body: "Hello Sharad",
        }),
      ),
    );
    expect(screen.getByText(/approval created for "Pitch Gideon"/i)).toBeTruthy();
  });
});
