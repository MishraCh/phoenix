import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let workspaceData: {
  connection: Record<string, unknown>;
  list: Array<Record<string, unknown>>;
} = {
  connection: {
    id: "gmail",
    provider: "gmail",
    status: "connected",
    capabilities: ["email.read", "email.draft", "email.send"],
    scopes: [],
    scopesGranted: [],
    lastSyncedAt: null,
    syncError: null,
    ownedByUserId: "user_123",
    connectedBy: "user_123",
    reconnectReason: "Watch setup still pending.",
    lastErrorCode: "gmail_watch_setup_failed",
    accountEmail: "founder@example.com",
    watchStatus: "pending",
    watchExpiration: null,
    lastDeltaSyncedAt: null,
    fullResyncRequired: true,
    access: "owner",
    ownerOnly: true,
  },
  list: [
    {
      id: "thread_1",
      threadId: "thread_1",
      subject: "Cached Gmail thread",
      snippet: "cached snippet",
      from: "advisor@example.com",
      lastMessageAt: null,
      unread: false,
    },
  ],
};

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ idToken: "token_123" }),
}));

vi.mock("../components/ui/ToastProvider", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

vi.mock("../hooks/useGideonQueries", () => ({
  useIntegrationWorkspaceQuery: () => ({
    data: workspaceData,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useIntegrationItemQuery: () => ({
    data: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useGmailStyleProfileQuery: () => ({
    data: { profile: null },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("../services/integrations", () => ({
  connectIntegration: vi.fn(),
  disconnectIntegration: vi.fn(),
  syncIntegration: vi.fn(),
  runIntegrationAction: vi.fn(),
  analyzeGmailStyleProfile: vi.fn(),
  deleteGmailStyleProfile: vi.fn(),
}));

import { GmailWorkspacePage } from "../components/app-shell/GmailWorkspacePage";

describe("GmailWorkspacePage", () => {
  it("renders Gmail watch pending and manual refresh required states", () => {
    workspaceData = {
      ...workspaceData,
      connection: {
        ...workspaceData.connection,
        access: "owner",
      },
      list: workspaceData.list,
    };

    render(<GmailWorkspacePage provider="gmail" />);

    expect(screen.getAllByText("founder@example.com").length).toBeGreaterThan(0);
    expect(screen.getByText(/Push sync still needs attention|history expired|bounded catch-up/i)).toBeTruthy();
    expect(screen.getByText("Manual catch-up required")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Refresh inbox/i })).toBeTruthy();
    expect(screen.getByText(/No Gmail writing style profile yet/i)).toBeTruthy();
  });

  it("shows an owner-only restricted state instead of raw Gmail thread data for non-owners", () => {
    workspaceData = {
      connection: {
        ...workspaceData.connection,
        access: "restricted",
        ownerOnly: true,
      },
      list: [],
    };

    render(<GmailWorkspacePage provider="gmail" />);

    expect(screen.getByText(/owner-only/i)).toBeTruthy();
    expect(screen.getByText(/restricted to the user who connected this mailbox/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Refresh inbox/i })).toBeDisabled();
  });
});
