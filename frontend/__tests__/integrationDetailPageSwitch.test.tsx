import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const integrationDetailMock = vi.fn();

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ idToken: "token_123" }),
}));

vi.mock("../components/ui/ToastProvider", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

vi.mock("../hooks/useGideonQueries", () => ({
  useIntegrationDetailQuery: (provider: string) => integrationDetailMock(provider),
}));

import { IntegrationDetailPage } from "../components/app-shell/IntegrationDetailPage";

describe("IntegrationDetailPage", () => {
  it("renders the polished Gmail integration overview", () => {
    integrationDetailMock.mockReturnValue({
      data: {
        provider: "gmail",
        status: "connected",
        capabilities: ["email.read"],
        scopesGranted: [],
        scopes: [],
        lastSyncedAt: "2026-05-18T08:00:00.000Z",
        syncError: null,
        ownedByUserId: "user_123",
        connectedBy: "user_123",
        reconnectReason: null,
        lastErrorCode: null,
        accountEmail: "founder@example.com",
        watchStatus: "active",
        watchExpiration: null,
        lastDeltaSyncedAt: null,
        fullResyncRequired: false,
        items: [],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<IntegrationDetailPage provider="gmail" />);

    expect(screen.getByText("Smart Summaries")).toBeTruthy();
    expect(screen.getByText("AI Drafting")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open Workspace/i })).toBeTruthy();
  });

  it("renders the HubSpot integration overview with live-read messaging", () => {
    integrationDetailMock.mockReturnValue({
      data: {
        provider: "hubspot",
        status: "connected",
        capabilities: ["crm.read"],
        scopesGranted: [],
        scopes: [],
        lastSyncedAt: null,
        syncError: null,
        ownedByUserId: "user_123",
        connectedBy: "user_123",
        reconnectReason: null,
        lastErrorCode: null,
        accountEmail: "ops@example.com",
        watchStatus: null,
        watchExpiration: null,
        lastDeltaSyncedAt: null,
        fullResyncRequired: false,
        items: [],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<IntegrationDetailPage provider="hubspot" />);

    expect(screen.getByText("Native CRM Views")).toBeTruthy();
    expect(screen.getByText("Approval-Gated")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open Workspace/i })).toBeTruthy();
  });
});
